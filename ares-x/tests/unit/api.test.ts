import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app';
import { JsonStore } from '../../backend/src/store';

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
