import { describe, expect, it } from 'vitest';
import {
  buildSeedSurvey,
  predicateSatisfied,
  resolveSyncConflict,
  resolveVisibility,
  validateDag
} from '../../shared/src';
import type { ConditionalEdge, SurveySchema } from '../../shared/src';

function cloneSurvey(version = 1): SurveySchema {
  return JSON.parse(JSON.stringify(buildSeedSurvey(version))) as SurveySchema;
}

function issueCodes(schema: SurveySchema) {
  return validateDag(schema).issues.map((issue) => issue.code);
}

describe('TDD unit tests: survey logic and DAG validity', () => {
  it('accepts a valid branching survey DAG', () => {
    const result = validateDag(buildSeedSurvey());
    expect(result.valid).toBe(true);
    expect(result.roots).toEqual(['q-channel']);
    expect(result.topologicalOrder).toContain('q-final');
  });

  it('rejects a cyclic conditional survey', () => {
    const schema = cloneSurvey();
    schema.edges.push({ id: 'e-cycle', from: 'q-final', to: 'q-channel', predicate: { kind: 'answered', questionId: 'q-final' } });
    const result = validateDag(schema);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'CYCLE_DETECTED')).toBe(true);
  });

  it('rejects edges that reference missing questions', () => {
    const schema = cloneSurvey();
    schema.edges.push({ id: 'e-missing-target', from: 'q-channel', to: 'q-ghost', predicate: { kind: 'answered', questionId: 'q-channel' } });
    expect(validateDag(schema).valid).toBe(false);
    expect(issueCodes(schema)).toContain('MISSING_EDGE_TARGET');
  });

  it('evaluates conditional branching predicates deterministically', () => {
    const equalsEdge: ConditionalEdge = {
      id: 'e-report-equals',
      from: 'q-channel',
      to: 'q-mobile-rating',
      predicate: { kind: 'equals', questionId: 'q-channel', value: 'mobile' }
    };
    const includesEdge: ConditionalEdge = {
      id: 'e-report-includes',
      from: 'q-mobile-pain',
      to: 'q-final',
      predicate: { kind: 'includes', questionId: 'q-mobile-pain', value: 'sync' }
    };

    expect(predicateSatisfied(equalsEdge.predicate, equalsEdge, { 'q-channel': 'mobile' })).toBe(true);
    expect(predicateSatisfied(equalsEdge.predicate, equalsEdge, { 'q-channel': 'web' })).toBe(false);
    expect(predicateSatisfied(includesEdge.predicate, includesEdge, { 'q-mobile-pain': ['speed', 'sync'] })).toBe(true);
    expect(predicateSatisfied({ kind: 'not-answered', questionId: 'q-final' }, equalsEdge, { 'q-final': '' })).toBe(true);
  });
});

describe('Algorithm verification tests: traversal and visibility', () => {
  it('gates Send until all visible required questions are answered', () => {
    const schema = buildSeedSurvey();
    const start = resolveVisibility(schema, {});
    expect(start.visibleQuestionIds).toEqual(['q-channel']);
    expect(start.sendEnabled).toBe(false);

    const branched = resolveVisibility(schema, { 'q-channel': 'mobile' });
    expect(branched.visibleQuestionIds).toContain('q-mobile-rating');
    expect(branched.sendEnabled).toBe(false);

    const complete = resolveVisibility(schema, { 'q-channel': 'mobile', 'q-mobile-rating': 4 });
    expect(complete.sendEnabled).toBe(true);
    expect(complete.blockers).toEqual([]);
  });

  it('traverses only the satisfied conditional path in topological order', () => {
    const schema = buildSeedSurvey();
    const webPath = resolveVisibility(schema, {
      'q-channel': 'web',
      'q-web-rating': 2,
      'q-low-score': 'The web flow was slow'
    });

    expect(webPath.visibleQuestionIds).toEqual(['q-channel', 'q-web-rating', 'q-low-score', 'q-final']);
    expect(webPath.visibleQuestionIds).not.toContain('q-mobile-rating');
    expect(webPath.sendEnabled).toBe(true);
  });

  it('keeps conditional child questions blocked until their parent path is complete', () => {
    const schema = buildSeedSurvey();
    const lowScorePrompt = resolveVisibility(schema, { 'q-channel': 'web', 'q-web-rating': 1 });
    expect(lowScorePrompt.visibleQuestionIds).toContain('q-low-score');
    expect(lowScorePrompt.blockers).toEqual(['q-low-score']);
    expect(lowScorePrompt.sendEnabled).toBe(false);
  });

  it('excludes hidden answers from completion and reports them for clearing', () => {
    const schema = buildSeedSurvey();
    const result = resolveVisibility(schema, { 'q-channel': 'mobile', 'q-web-rating': 5 });
    expect(result.visibleQuestionIds).not.toContain('q-web-rating');
    expect(result.hiddenClearedAnswerIds).toEqual(['q-web-rating']);
  });
});

describe('Conflict resolution tests: consistency, recovery, and rollback', () => {
  it('detects logic inconsistency when an edge predicate reads a deleted question', () => {
    const schema = cloneSurvey();
    schema.edges.push({
      id: 'e-reads-deleted-node',
      from: 'q-channel',
      to: 'q-final',
      predicate: { kind: 'answered', questionId: 'q-deleted' }
    });

    const validation = validateDag(schema);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.code === 'MISSING_PREDICATE_NODE')).toBe(true);
    expect(resolveVisibility(schema, { 'q-channel': 'mobile' }).sendEnabled).toBe(false);
  });

  it('preserves compatible answers with atomic state recovery', () => {
    const oldSchema = cloneSurvey(1);
    const newSchema = cloneSurvey(2);
    newSchema.questions.find((q) => q.id === 'q-final')!.title = 'Any last note for the research team?';
    const resolution = resolveSyncConflict(oldSchema, newSchema, { 'q-channel': 'mobile', 'q-mobile-rating': 4 });
    expect(resolution.action).toBe('atomic_recovery');
    expect(resolution.preservedAnswers).toEqual({ 'q-channel': 'mobile', 'q-mobile-rating': 4 });
    expect(resolution.visibility.sendEnabled).toBe(true);
  });

  it('rolls back to the last stable node after an answered node is deleted', () => {
    const oldSchema = cloneSurvey(1);
    const newSchema = cloneSurvey(2);
    newSchema.questions = newSchema.questions.filter((q) => q.id !== 'q-mobile-rating');
    newSchema.edges = newSchema.edges.filter((edge) => edge.from !== 'q-mobile-rating' && edge.to !== 'q-mobile-rating');
    const resolution = resolveSyncConflict(oldSchema, newSchema, { 'q-channel': 'mobile', 'q-mobile-rating': 4 });
    expect(resolution.action).toBe('rollback');
    expect(resolution.droppedAnswerIds).toEqual(['q-mobile-rating']);
    expect(resolution.rollbackStableNodeId).toBe('q-channel');
  });
});
