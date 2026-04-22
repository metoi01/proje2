export type QuestionType = 'single' | 'multiple' | 'rating' | 'text';

export type AnswerValue = string | string[] | number | null;
export type AnswerMap = Record<string, AnswerValue>;

export interface QuestionOption {
  value: string;
  label: string;
}

export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  title: string;
  required: boolean;
  stable: boolean;
  options?: QuestionOption[];
  min?: number;
  max?: number;
}

export type PredicateKind =
  | 'equals'
  | 'includes'
  | 'rating-at-least'
  | 'answered'
  | 'not-answered';

export interface Predicate {
  kind: PredicateKind;
  questionId?: string;
  value?: string | number;
}

export interface ConditionalEdge {
  id: string;
  from: string;
  to: string;
  predicate: Predicate;
}

export interface SurveySchema {
  id: string;
  title: string;
  description: string;
  version: number;
  schemaHash: string;
  questions: SurveyQuestion[];
  edges: ConditionalEdge[];
  publishedAt?: string;
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface DagValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  roots: string[];
  topologicalOrder: string[];
}

export interface VisibilityResult {
  visibleQuestionIds: string[];
  sendEnabled: boolean;
  blockers: string[];
  stableNodeId: string | null;
  orphanQuestionIds: string[];
  hiddenClearedAnswerIds: string[];
}

export type SyncAction = 'ok' | 'atomic_recovery' | 'rollback' | 'conflict';

export interface SyncResolution {
  action: SyncAction;
  conflictCode?: string;
  message: string;
  preservedAnswers: AnswerMap;
  droppedAnswerIds: string[];
  rollbackStableNodeId: string | null;
  visibility: VisibilityResult;
}

export interface SurveySession {
  id: string;
  surveyId: string;
  userId: string;
  schemaVersion: number;
  answers: AnswerMap;
  stableNodeId: string | null;
  status: 'active' | 'submitted' | 'conflict';
  createdAt: string;
  updatedAt: string;
}
