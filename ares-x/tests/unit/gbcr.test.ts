import { describe, expect, it } from 'vitest';
import { buildSeedSurvey, resolveSyncConflict, resolveVisibility, validateDag } from '../../shared/src';

describe('GBCR/RCLR shared logic', () => {
  it('accepts a valid branching survey DAG', () => {
    const result = validateDag(buildSeedSurvey());
    expect(result.valid).toBe(true);
    expect(result.roots).toEqual(['q-channel']);
  });

  it('rejects a cyclic conditional survey', () => {
    const schema = buildSeedSurvey();
    schema.edges.push({ id: 'e-cycle', from: 'q-final', to: 'q-channel', predicate: { kind: 'answered', questionId: 'q-final' } });
    const result = validateDag(schema);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'CYCLE_DETECTED')).toBe(true);
  });

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

  it('excludes hidden answers from completion and reports them for clearing', () => {
    const schema = buildSeedSurvey();
    const result = resolveVisibility(schema, { 'q-channel': 'mobile', 'q-web-rating': 5 });
    expect(result.visibleQuestionIds).not.toContain('q-web-rating');
    expect(result.hiddenClearedAnswerIds).toEqual(['q-web-rating']);
  });

  it('preserves compatible answers with atomic state recovery', () => {
    const oldSchema = buildSeedSurvey(1);
    const newSchema = buildSeedSurvey(2);
    newSchema.questions.find((q) => q.id === 'q-final')!.title = 'Any last note for the research team?';
    const resolution = resolveSyncConflict(oldSchema, newSchema, { 'q-channel': 'mobile', 'q-mobile-rating': 4 });
    expect(resolution.action).toBe('atomic_recovery');
    expect(resolution.preservedAnswers).toEqual({ 'q-channel': 'mobile', 'q-mobile-rating': 4 });
  });

  it('rolls back to the last stable node after an answered node is deleted', () => {
    const oldSchema = buildSeedSurvey(1);
    const newSchema = buildSeedSurvey(2);
    newSchema.questions = newSchema.questions.filter((q) => q.id !== 'q-mobile-rating');
    newSchema.edges = newSchema.edges.filter((edge) => edge.from !== 'q-mobile-rating' && edge.to !== 'q-mobile-rating');
    const resolution = resolveSyncConflict(oldSchema, newSchema, { 'q-channel': 'mobile', 'q-mobile-rating': 4 });
    expect(resolution.action).toBe('rollback');
    expect(resolution.droppedAnswerIds).toEqual(['q-mobile-rating']);
    expect(resolution.rollbackStableNodeId).toBe('q-channel');
  });
});
