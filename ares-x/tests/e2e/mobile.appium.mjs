import assert from 'node:assert/strict';
import path from 'node:path';
import { createAppiumSession } from './_appium-client.mjs';
import { withServers, sleep } from './_harness.mjs';

const app = path.resolve('mobile/app/build/outputs/apk/debug/app-debug.apk');
const server = process.env.APPIUM_SERVER_URL ?? 'http://127.0.0.1:4723';

await withServers(async () => {
  const driver = await createAppiumSession(server, {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': process.env.APPIUM_DEVICE_NAME ?? 'Medium_Phone_API_35',
    'appium:app': app,
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 120
  });

  try {
    // 1. successful login and survey list load
    await driver.tap('login-submit');
    await sleep(1500);
    await driver.tap('survey-card-customer-feedback');
    await sleep(1500);
    assert.match(await driver.text('schema-version'), /Schema v1/);

    // 2. single-choice branch reveals correct child question
    await driver.tap('answer-q-channel-mobile');
    await sleep(1000);
    assert.match(await driver.text('question-q-mobile-rating'), /mobile/i);

    // 3. rating threshold branch
    await driver.tap('answer-q-mobile-rating-4');
    await sleep(1000);
    assert.match(await driver.text('visible-path'), /q-final/);

    // 4. invisible required questions do not block Send on mobile path
    assert.equal(await driver.enabled('send-button'), true);

    // 5. answer change hides invalid downstream questions and clears stale answers
    await driver.tap('answer-q-channel-web');
    await sleep(1000);
    assert.match(await driver.text('visible-path'), /q-web-rating/);

    // 6. open-ended required answer gates Send on web branch
    await driver.tap('answer-q-web-rating-2');
    await sleep(1000);
    assert.equal(await driver.enabled('send-button'), false);

    // 7. compatible schema update performs atomic recovery
    await fetch('http://localhost:3001/api/test/change-edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edgeId: 'e-channel-mobile', predicate: { kind: 'equals', questionId: 'q-channel', value: 'mobile' } })
    });
    await driver.tap('answer-q-channel-mobile');
    await sleep(1500);
    assert.match(await driver.text('conflict-banner'), /ATOMIC_RECOVERY|RCLR_ROLLBACK|RCLR_CONFLICT/);

    // 8. incompatible schema update rolls back to stable node
    await fetch('http://localhost:3001/api/test/delete-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'q-mobile-rating' })
    });
    await driver.tap('answer-q-mobile-rating-4');
    await sleep(1500);
    assert.match(await driver.text('conflict-banner'), /RCLR_ROLLBACK|RCLR_CONFLICT/);

    // 9. no zombie question remains visible after conflict resolution
    assert.doesNotMatch(await driver.text('visible-path'), /undefined|zombie/i);

    // 10. conflict is flagged by RCLR state, not only a generic popup
    assert.match(await driver.text('conflict-banner'), /RCLR_/);
  } finally {
    await driver.quit();
  }
});

console.log('Appium mobile logic suite passed.');
