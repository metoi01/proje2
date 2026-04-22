import express from 'express';
import cors from 'cors';
import {
  AnswerMap,
  computeSchemaHash,
  resolveSyncConflict,
  resolveVisibility,
  sanitizeAnswersForSchema,
  SurveySchema,
  SurveySession,
  validateDag
} from '../../shared/src';
import { defaultStorePath, JsonStore } from './store';

const now = () => new Date().toISOString();

export function createApp(store = new JsonStore(defaultStorePath())) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'ares-x', time: now() }));

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    const user = store.read().users.find((candidate) => candidate.email === email && candidate.password === password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const { password: _password, ...safeUser } = user;
    return res.json({ token: `demo-token-${safeUser.id}`, user: safeUser });
  });

  app.get('/api/surveys', (_req, res) => {
    res.json({ surveys: store.read().surveys });
  });

  app.post('/api/surveys', (req, res) => {
    const candidate = normalizeSurvey(req.body);
    const validation = validateDag(candidate);
    if (!validation.valid) return res.status(400).json({ validation });
    store.update((db) => {
      db.surveys.push(candidate);
      db.history[candidate.id] = [candidate];
    });
    return res.status(201).json({ survey: candidate, validation });
  });

  app.put('/api/surveys/:id', (req, res) => {
    const candidate = normalizeSurvey({ ...req.body, id: req.params.id });
    const validation = validateDag(candidate);
    store.update((db) => {
      const index = db.surveys.findIndex((survey) => survey.id === req.params.id);
      if (index === -1) {
        db.surveys.push(candidate);
      } else {
        db.surveys[index] = candidate;
      }
    });
    return res.json({ survey: candidate, validation });
  });

  app.post('/api/surveys/:id/publish', (req, res) => {
    const db = store.read();
    const existing = db.surveys.find((survey) => survey.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Survey not found' });
    const validation = validateDag(existing);
    if (!validation.valid) return res.status(400).json({ validation });
    const published: SurveySchema = {
      ...existing,
      version: existing.version + 1,
      publishedAt: now()
    };
    published.schemaHash = computeSchemaHash(published);
    store.update((draft) => {
      const index = draft.surveys.findIndex((survey) => survey.id === published.id);
      draft.surveys[index] = published;
      draft.history[published.id] = [...(draft.history[published.id] ?? []), published];
    });
    return res.json({ survey: published, validation });
  });

  app.get('/api/surveys/:id/schema', (req, res) => {
    const db = store.read();
    const requestedVersion = req.query.version ? Number(req.query.version) : null;
    const schema = requestedVersion
      ? (db.history[req.params.id] ?? []).find((entry) => entry.version === requestedVersion)
      : db.surveys.find((survey) => survey.id === req.params.id);
    if (!schema) return res.status(404).json({ error: 'Schema not found' });
    return res.json({ schema, validation: validateDag(schema) });
  });

  app.post('/api/sessions', (req, res) => {
    const { surveyId, userId = 'u-alice' } = req.body ?? {};
    const schema = store.read().surveys.find((survey) => survey.id === surveyId);
    if (!schema) return res.status(404).json({ error: 'Survey not found' });
    const visibility = resolveVisibility(schema, {});
    const session: SurveySession = {
      id: `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      surveyId,
      userId,
      schemaVersion: schema.version,
      answers: {},
      stableNodeId: visibility.stableNodeId,
      status: 'active',
      createdAt: now(),
      updatedAt: now()
    };
    store.update((db) => {
      db.sessions.push(session);
    });
    return res.status(201).json({ session, schema, visibility });
  });

  app.patch('/api/sessions/:id/answers', (req, res) => {
    const { answers = {}, clientSchemaVersion } = req.body as { answers: AnswerMap; clientSchemaVersion?: number };
    const db = store.read();
    const session = db.sessions.find((candidate) => candidate.id === req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const currentSchema = db.surveys.find((survey) => survey.id === session.surveyId);
    if (!currentSchema) return res.status(404).json({ error: 'Survey not found' });
    const clientVersion = clientSchemaVersion ?? session.schemaVersion;
    const oldSchema = (db.history[session.surveyId] ?? []).find((schema) => schema.version === clientVersion) ?? currentSchema;
    let payload;
    if (clientVersion !== currentSchema.version) {
      const resolution = resolveSyncConflict(oldSchema, currentSchema, answers);
      session.answers = resolution.preservedAnswers;
      session.schemaVersion = currentSchema.version;
      session.stableNodeId = resolution.rollbackStableNodeId ?? resolution.visibility.stableNodeId;
      session.status = resolution.action === 'conflict' ? 'conflict' : 'active';
      session.updatedAt = now();
      payload = { session, schema: currentSchema, resolution };
    } else {
      const preserved = sanitizeAnswersForSchema(currentSchema, answers);
      const visibility = resolveVisibility(currentSchema, preserved);
      session.answers = preserved;
      session.stableNodeId = visibility.stableNodeId;
      session.status = visibility.orphanQuestionIds.length ? 'conflict' : 'active';
      session.updatedAt = now();
      payload = {
        session,
        schema: currentSchema,
        resolution: {
          action: visibility.orphanQuestionIds.length ? 'conflict' : 'ok',
          conflictCode: visibility.orphanQuestionIds.length ? 'RCLR_CONFLICT' : undefined,
          message: visibility.orphanQuestionIds.length ? 'RCLR found an undefined UI state.' : 'Answers accepted.',
          preservedAnswers: preserved,
          droppedAnswerIds: visibility.hiddenClearedAnswerIds,
          rollbackStableNodeId: visibility.stableNodeId,
          visibility
        }
      };
    }
    store.write(db);
    return res.json(payload);
  });

  app.post('/api/test/reset', (_req, res) => {
    store.reset();
    res.json({ ok: true, db: store.read() });
  });

  app.post('/api/test/delete-node', (req, res) => {
    const { surveyId = 'customer-feedback', nodeId } = req.body ?? {};
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });
    let updated: SurveySchema | undefined;
    store.update((db) => {
      const survey = db.surveys.find((candidate) => candidate.id === surveyId);
      if (!survey) return;
      survey.questions = survey.questions.filter((question) => question.id !== nodeId);
      survey.edges = survey.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId && edge.predicate.questionId !== nodeId);
      survey.version += 1;
      survey.publishedAt = now();
      survey.schemaHash = computeSchemaHash(survey);
      db.history[survey.id] = [...(db.history[survey.id] ?? []), JSON.parse(JSON.stringify(survey))];
      updated = survey;
    });
    if (!updated) return res.status(404).json({ error: 'Survey not found' });
    return res.json({ survey: updated, validation: validateDag(updated) });
  });

  app.post('/api/test/change-edge', (req, res) => {
    const { surveyId = 'customer-feedback', edgeId, predicate } = req.body ?? {};
    let updated: SurveySchema | undefined;
    store.update((db) => {
      const survey = db.surveys.find((candidate) => candidate.id === surveyId);
      const edge = survey?.edges.find((candidate) => candidate.id === edgeId);
      if (!survey || !edge) return;
      edge.predicate = predicate;
      survey.version += 1;
      survey.publishedAt = now();
      survey.schemaHash = computeSchemaHash(survey);
      db.history[survey.id] = [...(db.history[survey.id] ?? []), JSON.parse(JSON.stringify(survey))];
      updated = survey;
    });
    if (!updated) return res.status(404).json({ error: 'Survey or edge not found' });
    return res.json({ survey: updated, validation: validateDag(updated) });
  });

  return app;
}

function normalizeSurvey(input: Partial<SurveySchema>): SurveySchema {
  const candidate: SurveySchema = {
    id: input.id || `survey-${Date.now()}`,
    title: input.title || 'Untitled Survey',
    description: input.description || '',
    version: input.version ?? 1,
    schemaHash: '',
    questions: input.questions ?? [],
    edges: input.edges ?? [],
    publishedAt: input.publishedAt
  };
  candidate.schemaHash = computeSchemaHash(candidate);
  return candidate;
}
