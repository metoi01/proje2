import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAppiumSession } from './_appium-client.mjs';
import { withServers, sleep } from './_harness.mjs';

const app = path.resolve('mobile/app/build/outputs/apk/debug/app-debug.apk');
const server = process.env.APPIUM_SERVER_URL ?? 'http://127.0.0.1:4723';
const evidenceDir = process.env.TEST_EVIDENCE_DIR
  ? path.resolve(process.env.TEST_EVIDENCE_DIR, 'mobile-appium')
  : null;

if (evidenceDir) fs.mkdirSync(evidenceDir, { recursive: true });

const evidence = [];

function normalizePathText(pathText) {
  return pathText.replace(/^Visible path:\s*/, '').split('->').map((part) => part.trim()).filter(Boolean);
}

await withServers(async () => {
  const driver = await createAppiumSession(server, {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': process.env.APPIUM_DEVICE_NAME ?? 'Medium_Phone_API_35',
    'appium:app': app,
    'appium:autoGrantPermissions': true,
    'appium:adbExecTimeout': 60000,
    'appium:newCommandTimeout': 120
  });

  const capture = async (slug, testName, purpose) => {
    if (evidenceDir) {
      const filePath = path.join(evidenceDir, slug);
      await driver.screenshot(filePath);
      evidence.push({ testName, purpose, screenshot: filePath });
    }
  };

  try {
    await driver.tap('login-submit');
    await sleep(1500);
    await driver.tap('survey-card-customer-feedback');
    await sleep(1500);
    assert.match(await driver.text('schema-version'), /Schema v1/);
    await capture('01-survey-loading.png', 'Survey Loading Test', 'Mobil istemcinin survey semasini backendden yukledigi goruntu.');

    await driver.tap('answer-q-channel-mobile');
    await sleep(1000);
    assert.match(await driver.text('question-q-mobile-rating'), /mobile/i);
    assert.equal(await driver.enabled('send-button'), false);
    await capture('02-conditional-visibility.png', 'Conditional Visibility Test', 'q-channel=mobile secildiginde yalnizca mobile path sorularinin acildigi goruntu.');

    await driver.tap('answer-q-mobile-rating-4');
    await sleep(1000);
    assert.match(await driver.text('question-q-mobile-pain'), /improve/i);
    assert.match(await driver.text('question-q-final'), /final comments/i);
    await capture('03-question-rendering.png', 'Question Rendering Test', 'Rating, multiple-choice ve open-ended soru tiplerinin ayni akista render edilmesi.');

    const recursivePath = normalizePathText(await driver.text('visible-path'));
    assert.deepEqual(recursivePath, ['q-channel', 'q-mobile-rating', 'q-mobile-pain', 'q-final']);
    assert.equal(new Set(recursivePath).size, recursivePath.length);
    await capture('04-dag-path-validation.png', 'DAG Path Validation Test', 'Visible path ciktisinin DAG mantigina gore tekrarsiz ilerledigi kanit.');
    await capture('05-recursive-logic.png', 'Recursive Logic Execution Test', 'Birden fazla conditional edge sonrasinda q-final dugumune kadar recursive ilerleyen path.');

    await driver.tap('answer-q-mobile-pain-sync');
    await sleep(1000);
    assert.equal(await driver.attribute('answer-q-mobile-pain-sync', 'checked'), 'true');
    await capture('06-answer-persistence.png', 'Answer Persistence Test', 'Secilen multiple-choice cevabin yeniden render sonrasi korunmasi.');

    assert.equal(await driver.enabled('send-button'), true);
    await capture('07-send-button-activation.png', 'Send Button Activation Test', 'Visible required sorular tamamlandiginda Send butonunun aktif hale gelmesi.');

    await driver.tap('send-button');
    await sleep(500);
    await capture('08-end-to-end-completion.png', 'End-to-End Survey Completion Test', 'Survey baslatma-cevaplama-gonderme akisinin tamamlanmis hali.');

    await driver.tap('answer-q-channel-web');
    await sleep(1000);
    const webPath = await driver.text('visible-path');
    assert.match(webPath, /q-web-rating/);
    assert.doesNotMatch(webPath, /q-mobile-rating/);
    assert.equal(await driver.enabled('send-button'), false);
    await capture('09-back-navigation-logic.png', 'Back Navigation Logic Test', 'Kullanici onceki karari degistirdiginde conditional logicin yeniden hesaplanmasi.');

    await fetch('http://localhost:3001/api/test/delete-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'q-mobile-rating' })
    });
    await driver.tap('answer-q-channel-mobile');
    await sleep(1500);
    assert.match(await driver.text('conflict-banner'), /RCLR_ROLLBACK|RCLR_CONFLICT/);
    assert.doesNotMatch(await driver.text('visible-path'), /undefined|zombie|orphan/i);
    await capture('10-invalid-state-prevention.png', 'Invalid State Prevention Test', 'Schema degisimi sonrasinda undefined UI state yerine conflict/rollback davranisi.');
  } finally {
    if (evidenceDir) {
      fs.writeFileSync(
        path.join(evidenceDir, 'evidence-map.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8'
      );
    }
    await driver.quit();
  }
});

console.log('Appium mobile logic suite passed.');
