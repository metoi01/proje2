import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app';
import { JsonStore } from '../../backend/src/store';
import { buildSeedSurvey } from '../../shared/src';

function testApp() {
  const store = new JsonStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ares-x-')), 'db.json'));
  return createApp(store);
}

describe('ARES-X backend API', () => {
  it('logs in seeded Project 1 users', async () => {
    const response = await request(testApp())
      .post('/api/auth/login')
      .send({ email: 'alice@ares.test', password: 'Test1234!' })
      .expect(200);
    expect(response.body.user.email).toBe('alice@ares.test');
  });

  it('increments schema version on publish', async () => {
    const app = testApp();
    const before = await request(app).get('/api/surveys/customer-feedback/schema').expect(200);
    const published = await request(app).post('/api/surveys/customer-feedback/publish').send({}).expect(200);
    expect(published.body.survey.version).toBe(before.body.schema.version + 1);
  });

  it('creates a survey with explicit conditional logic only when the DAG is valid', async () => {
    const schema = buildSeedSurvey();
    schema.id = 'report-conditional-survey';
    schema.title = 'Report Conditional Survey';

    const response = await request(testApp())
      .post('/api/surveys')
      .send(schema)
      .expect(201);

    expect(response.body.validation.valid).toBe(true);
    expect(response.body.survey.edges.some((edge: { id: string }) => edge.id === 'e-channel-mobile')).toBe(true);
  });

  it('blocks publish when a schema update introduces a cycle', async () => {
    const app = testApp();
    const schema = buildSeedSurvey();
    schema.edges.push({ id: 'e-report-cycle', from: 'q-final', to: 'q-channel', predicate: { kind: 'answered', questionId: 'q-final' } });

    const draft = await request(app).put('/api/surveys/customer-feedback').send(schema).expect(200);
    expect(draft.body.validation.valid).toBe(false);

    const publish = await request(app).post('/api/surveys/customer-feedback/publish').send({}).expect(400);
    expect(publish.body.validation.issues.some((issue: { code: string }) => issue.code === 'CYCLE_DETECTED')).toBe(true);
  });

  it('updates survey schema and recomputes the schema hash', async () => {
    const app = testApp();
    const before = await request(app).get('/api/surveys/customer-feedback/schema').expect(200);
    const schema = before.body.schema;
    schema.questions = [
      ...schema.questions,
      {
        id: 'q-api-added',
        type: 'text',
        title: 'API-added audit note',
        required: false,
        stable: false
      }
    ];

    const updated = await request(app).put('/api/surveys/customer-feedback').send(schema).expect(200);
    expect(updated.body.validation.valid).toBe(true);
    expect(updated.body.survey.schemaHash).not.toBe(before.body.schema.schemaHash);
    expect(updated.body.survey.questions.some((question: { id: string }) => question.id === 'q-api-added')).toBe(true);
  });

  it('starts a session, accepts answers, and reaches send-enabled survey completion', async () => {
    const app = testApp();
    const session = await request(app).post('/api/sessions').send({ surveyId: 'customer-feedback', userId: 'u-alice' }).expect(201);
    const sync = await request(app)
      .patch(`/api/sessions/${session.body.session.id}/answers`)
      .send({ clientSchemaVersion: 1, answers: { 'q-channel': 'mobile', 'q-mobile-rating': 5 } })
      .expect(200);

    expect(sync.body.resolution.action).toBe('ok');
    expect(sync.body.resolution.visibility.sendEnabled).toBe(true);
    expect(sync.body.session.answers).toEqual({ 'q-channel': 'mobile', 'q-mobile-rating': 5 });
  });

  it('marks a completed session as submitted', async () => {
    const app = testApp();
    const session = await request(app).post('/api/sessions').send({ surveyId: 'customer-feedback', userId: 'u-alice' }).expect(201);

    const submit = await request(app)
      .post(`/api/sessions/${session.body.session.id}/submit`)
      .send({
        clientSchemaVersion: 1,
        answers: {
          'q-channel': 'mobile',
          'q-mobile-rating': 4,
          'q-mobile-pain': ['sync'],
          'q-final': 'Looks much better now.'
        }
      })
      .expect(200);

    expect(submit.body.session.status).toBe('submitted');
    expect(submit.body.resolution.message).toBe('Survey submitted.');
    expect(submit.body.resolution.visibility.sendEnabled).toBe(true);
  });

  it('returns atomic recovery instructions on compatible schema drift', async () => {
    const app = testApp();
    const session = await request(app).post('/api/sessions').send({ surveyId: 'customer-feedback', userId: 'u-alice' }).expect(201);
    await request(app)
      .post('/api/test/change-edge')
      .send({ edgeId: 'e-channel-mobile', predicate: { kind: 'equals', questionId: 'q-channel', value: 'mobile' } })
      .expect(200);

    const sync = await request(app)
      .patch(`/api/sessions/${session.body.session.id}/answers`)
      .send({ clientSchemaVersion: 1, answers: { 'q-channel': 'mobile', 'q-mobile-rating': 4 } })
      .expect(200);

    expect(sync.body.resolution.action).toBe('atomic_recovery');
    expect(sync.body.resolution.preservedAnswers).toEqual({ 'q-channel': 'mobile', 'q-mobile-rating': 4 });
  });

  it('returns rollback instructions on incompatible sync', async () => {
    const app = testApp();
    const session = await request(app).post('/api/sessions').send({ surveyId: 'customer-feedback', userId: 'u-alice' }).expect(201);
    await request(app).post('/api/test/delete-node').send({ nodeId: 'q-mobile-rating' }).expect(200);
    const sync = await request(app)
      .patch(`/api/sessions/${session.body.session.id}/answers`)
      .send({ clientSchemaVersion: 1, answers: { 'q-channel': 'mobile', 'q-mobile-rating': 4 } })
      .expect(200);
    expect(sync.body.resolution.action).toBe('rollback');
    expect(sync.body.resolution.conflictCode).toBe('RCLR_ROLLBACK');
  });
});
