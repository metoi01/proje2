import assert from 'node:assert/strict';
import path from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import chromedriver from 'chromedriver';
import { createAppiumSession } from './_appium-client.mjs';
import { withServers, sleep } from './_harness.mjs';

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

    const selectMobile = appium.tap('answer-q-channel-mobile');
    const mutateWebLogic = fetch('http://localhost:3001/api/test/delete-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'q-mobile-rating' })
    });
    await Promise.all([selectMobile, mutateWebLogic]);
    await sleep(1800);

    const banner = await appium.text('conflict-banner');
    assert.match(banner, /RCLR_ROLLBACK|RCLR_CONFLICT/);
    const pathText = await appium.text('visible-path');
    assert.doesNotMatch(pathText, /q-mobile-rating.*q-mobile-rating/);
  } finally {
    await appium.quit();
    await web.quit();
  }
});

console.log('Selenium + Appium synchronized sync-conflict scenario passed.');
