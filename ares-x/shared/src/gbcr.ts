import {
  AnswerMap,
  AnswerValue,
  ConditionalEdge,
  DagValidationResult,
  Predicate,
  SurveyQuestion,
  SurveySchema,
  SyncResolution,
  ValidationIssue,
  VisibilityResult
} from './types';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function computeSchemaHash(schema: Omit<SurveySchema, 'schemaHash'> | SurveySchema): string {
  const clone = JSON.parse(JSON.stringify(schema)) as SurveySchema;
  clone.schemaHash = '';
  const input = stableStringify({
    id: clone.id,
    title: clone.title,
    description: clone.description,
    questions: clone.questions,
    edges: clone.edges
  });
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `gbcr-${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

export function isAnswered(value: AnswerValue): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return false;
}

export function predicateSatisfied(predicate: Predicate, edge: ConditionalEdge, answers: AnswerMap): boolean {
  const questionId = predicate.questionId ?? edge.from;
  const answer = answers[questionId];
  switch (predicate.kind) {
    case 'equals':
      return answer === predicate.value;
    case 'includes':
      return Array.isArray(answer) && answer.includes(String(predicate.value));
    case 'rating-at-least':
      return typeof answer === 'number' && answer >= Number(predicate.value);
    case 'answered':
      return isAnswered(answer);
    case 'not-answered':
      return !isAnswered(answer);
    default:
      return false;
  }
}

export function validateDag(schema: SurveySchema): DagValidationResult {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const q of schema.questions) {
    if (!q.id.trim()) {
      issues.push({ code: 'EMPTY_NODE_ID', severity: 'error', message: 'Question id cannot be empty.' });
      continue;
    }
    if (nodeIds.has(q.id)) {
      issues.push({ code: 'DUPLICATE_NODE', severity: 'error', message: `Duplicate question id ${q.id}.`, nodeId: q.id });
    }
    nodeIds.add(q.id);
    incoming.set(q.id, 0);
    outgoing.set(q.id, []);
    if ((q.type === 'single' || q.type === 'multiple') && (!q.options || q.options.length === 0)) {
      issues.push({ code: 'MISSING_OPTIONS', severity: 'error', message: `${q.id} needs answer options.`, nodeId: q.id });
    }
  }

  const edgeKeys = new Set<string>();
  for (const edge of schema.edges) {
    if (!nodeIds.has(edge.from)) {
      issues.push({ code: 'MISSING_EDGE_SOURCE', severity: 'error', message: `${edge.id} points from a missing question.`, edgeId: edge.id });
    }
    if (!nodeIds.has(edge.to)) {
      issues.push({ code: 'MISSING_EDGE_TARGET', severity: 'error', message: `${edge.id} points to a missing question.`, edgeId: edge.id });
    }
    const predicateQuestion = edge.predicate.questionId ?? edge.from;
    if (!nodeIds.has(predicateQuestion)) {
      issues.push({ code: 'MISSING_PREDICATE_NODE', severity: 'error', message: `${edge.id} reads a missing question.`, edgeId: edge.id });
    }
    const key = `${edge.from}->${edge.to}:${stableStringify(edge.predicate)}`;
    if (edgeKeys.has(key)) {
      issues.push({ code: 'DUPLICATE_EDGE', severity: 'warning', message: `${edge.id} duplicates an existing condition.`, edgeId: edge.id });
    }
    edgeKeys.add(key);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const roots = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  if (schema.questions.length > 0 && roots.length === 0) {
    issues.push({ code: 'NO_ROOT', severity: 'error', message: 'A DAG survey must have at least one root question.' });
  }

  const indegree = new Map(incoming);
  const queue = roots.slice();
  const topologicalOrder: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    topologicalOrder.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }
  if (topologicalOrder.length !== schema.questions.length) {
    issues.push({ code: 'CYCLE_DETECTED', severity: 'error', message: 'Conditional logic must be acyclic.' });
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    roots,
    topologicalOrder
  };
}

function questionMap(schema: SurveySchema): Map<string, SurveyQuestion> {
  return new Map(schema.questions.map((q) => [q.id, q]));
}

export function resolveVisibility(schema: SurveySchema, answers: AnswerMap): VisibilityResult {
  const validation = validateDag(schema);
  const questions = questionMap(schema);
  const incomingByTarget = new Map<string, ConditionalEdge[]>();
  const outgoingBySource = new Map<string, ConditionalEdge[]>();
  for (const edge of schema.edges) {
    if (!questions.has(edge.from) || !questions.has(edge.to)) continue;
    incomingByTarget.set(edge.to, [...(incomingByTarget.get(edge.to) ?? []), edge]);
    outgoingBySource.set(edge.from, [...(outgoingBySource.get(edge.from) ?? []), edge]);
  }

  const visible = new Set<string>();
  const orphanQuestionIds = new Set<string>();
  const roots = validation.roots.length ? validation.roots : schema.questions.slice(0, 1).map((q) => q.id);

  const visit = (id: string) => {
    if (visible.has(id) || !questions.has(id)) return;
    visible.add(id);
    for (const edge of outgoingBySource.get(id) ?? []) {
      if (predicateSatisfied(edge.predicate, edge, answers)) {
        visit(edge.to);
      }
    }
  };
  roots.forEach(visit);

  for (const id of [...visible]) {
    if (roots.includes(id)) continue;
    const parents = incomingByTarget.get(id) ?? [];
    const hasLogicalParent = parents.some((edge) => visible.has(edge.from) && predicateSatisfied(edge.predicate, edge, answers));
    if (!hasLogicalParent) orphanQuestionIds.add(id);
  }

  const visibleQuestionIds = validation.topologicalOrder.filter((id) => visible.has(id));
  const blockers = visibleQuestionIds
    .map((id) => questions.get(id)!)
    .filter((q) => q.required && !isAnswered(answers[q.id]))
    .map((q) => q.id);

  const hiddenClearedAnswerIds = Object.keys(answers).filter((id) => !visible.has(id));
  const answeredVisibleStable = visibleQuestionIds
    .map((id) => questions.get(id)!)
    .filter((q) => q.stable && isAnswered(answers[q.id]));
  const fallbackStable = visibleQuestionIds
    .map((id) => questions.get(id)!)
    .find((q) => q.stable);

  return {
    visibleQuestionIds,
    sendEnabled: blockers.length === 0 && orphanQuestionIds.size === 0 && validation.valid,
    blockers,
    stableNodeId: answeredVisibleStable.at(-1)?.id ?? fallbackStable?.id ?? null,
    orphanQuestionIds: [...orphanQuestionIds],
    hiddenClearedAnswerIds
  };
}

export function sanitizeAnswersForSchema(schema: SurveySchema, answers: AnswerMap): AnswerMap {
  const ids = new Set(schema.questions.map((q) => q.id));
  return Object.fromEntries(Object.entries(answers).filter(([id, value]) => ids.has(id) && isAnswered(value)));
}

export function resolveSyncConflict(
  oldSchema: SurveySchema,
  newSchema: SurveySchema,
  clientAnswers: AnswerMap
): SyncResolution {
  const newQuestionById = questionMap(newSchema);
  const oldQuestionById = questionMap(oldSchema);
  const oldVisibility = resolveVisibility(oldSchema, clientAnswers);
  const preservedAnswers: AnswerMap = {};
  const droppedAnswerIds: string[] = [];

  for (const [id, value] of Object.entries(clientAnswers)) {
    const oldQuestion = oldQuestionById.get(id);
    const newQuestion = newQuestionById.get(id);
    if (!oldQuestion || !newQuestion || oldQuestion.type !== newQuestion.type) {
      droppedAnswerIds.push(id);
      continue;
    }
    preservedAnswers[id] = value;
  }

  const visibility = resolveVisibility(newSchema, preservedAnswers);
  const hiddenAnswered = Object.keys(preservedAnswers).filter((id) => !visibility.visibleQuestionIds.includes(id));
  if (hiddenAnswered.length) {
    hiddenAnswered.forEach((id) => {
      delete preservedAnswers[id];
      droppedAnswerIds.push(id);
    });
  }

  const removedVisiblePathIds = oldVisibility.visibleQuestionIds.filter((id) => !newQuestionById.has(id));
  if (removedVisiblePathIds.length) {
    return {
      action: 'rollback',
      conflictCode: 'RCLR_ROLLBACK',
      message: 'A visible path node was removed by a newer schema; session rolled back to the last stable node.',
      preservedAnswers,
      droppedAnswerIds: [...new Set([...droppedAnswerIds, ...removedVisiblePathIds])],
      rollbackStableNodeId: visibility.stableNodeId,
      visibility
    };
  }

  if (visibility.orphanQuestionIds.length) {
    return {
      action: 'conflict',
      conflictCode: 'RCLR_CONFLICT',
      message: 'The new schema would expose a zombie question without a logical parent.',
      preservedAnswers,
      droppedAnswerIds,
      rollbackStableNodeId: visibility.stableNodeId,
      visibility
    };
  }

  if (droppedAnswerIds.length) {
    return {
      action: 'rollback',
      conflictCode: 'RCLR_ROLLBACK',
      message: 'Schema changed incompatibly; session rolled back to the last stable node.',
      preservedAnswers,
      droppedAnswerIds,
      rollbackStableNodeId: visibility.stableNodeId,
      visibility: resolveVisibility(newSchema, preservedAnswers)
    };
  }

  return {
    action: 'atomic_recovery',
    message: 'Schema version changed; answers were atomically mapped to the new DAG.',
    preservedAnswers,
    droppedAnswerIds,
    rollbackStableNodeId: null,
    visibility
  };
}
