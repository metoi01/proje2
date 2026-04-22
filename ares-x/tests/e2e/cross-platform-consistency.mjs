import assert from 'node:assert/strict';
import path from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import chromedriver from 'chromedriver';
import { createAppiumSession } from './_appium-client.mjs';
import { withServers, sleep } from './_harness.mjs';

async function setTestValue(driver, testId, value) {
  await driver.executeScript((id, nextValue) => {
    const element = document.querySelector(`[data-testid="${id}"]`);
    if (!element) throw new Error(`Missing test element ${id}`);
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, testId, value);
}

await withServers(async () => {
  const appium = await createAppiumSession(process.env.APPIUM_SERVER_URL ?? 'http://127.0.0.1:4723', {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': process.env.APPIUM_DEVICE_NAME ?? 'Medium_Phone_API_35',
    'appium:app': path.resolve('mobile/app/build/outputs/apk/debug/app-debug.apk'),
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 120
  });

  const web = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(new chrome.Options().addArguments('--headless=new', '--window-size=1440,1000'))
    .setChromeService(new chrome.ServiceBuilder(chromedriver.path))
    .build();

  try {
    await web.get('http://localhost:5173');
    await web.wait(until.elementLocated(By.css('[data-testid="web-login-submit"]')), 10000);
    await web.findElement(By.css('[data-testid="web-login-submit"]')).click();
    await web.wait(until.elementLocated(By.css('[data-testid="dag-status"]')), 10000);

    await appium.tap('login-submit');
    await sleep(1000);
    await appium.tap('survey-card-customer-feedback');
    await sleep(1000);
    assert.match(await appium.text('schema-version'), /Schema v1/);

    await web.findElement(By.css('[data-testid="new-question-title"]')).sendKeys('Mobile schema sync audit');
    await web.findElement(By.css('[data-testid="add-question"]')).click();
    await web.wait(until.elementLocated(By.css('[data-testid^="question-editor-q-mobile-schema-sync-audit"]')), 10000);
    await setTestValue(web, 'edge-from', 'q-channel');
    await setTestValue(web, 'edge-to', 'q-mobile-schema-sync-audit');
    await setTestValue(web, 'edge-kind', 'equals');
    await setTestValue(web, 'edge-value', 'mobile');
    await web.findElement(By.css('[data-testid="add-edge"]')).click();
    await web.wait(async () => {
      const rows = await web.findElements(By.css('[data-testid^="edge-e-q-channel-q-mobile-schema-sync-audit"]'));
      return rows.length > 0 && (await rows[0].getText()).includes('equals mobile');
    }, 10000);
    await web.findElement(By.css('[data-testid="publish-survey"]')).click();
    await web.wait(async () => {
      const text = await web.findElement(By.css('[data-testid="survey-customer-feedback"] small')).getText();
      return text.includes('v2');
    }, 10000);

    await appium.tap('answer-q-channel-mobile');
    await sleep(2000);
    assert.match(await appium.text('conflict-banner'), /ATOMIC_RECOVERY/);
    assert.match(await appium.text('schema-version'), /Schema v2/);
    assert.match(await appium.text('question-q-mobile-schema-sync-audit'), /Mobile schema sync audit/i);
  } finally {
    await appium.quit();
    await web.quit();
  }
});

console.log('Cross-platform Web Architect to mobile consistency scenario passed.');
