import fs from 'node:fs';
import path from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { createAppiumSession } from '../tests/e2e/_appium-client.mjs';
import { withServers, sleep } from '../tests/e2e/_harness.mjs';

const outDir = path.resolve('docs/screenshots');
fs.mkdirSync(outDir, { recursive: true });

await withServers(async () => {
  const options = new chrome.Options();
  options.addArguments('--headless=new', '--window-size=1440,1000');
  const web = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  try {
    await web.get('http://localhost:5173');
    await web.wait(until.elementLocated(By.css('[data-testid="web-login-submit"]')), 10000);
    await web.takeScreenshot().then((png) => fs.writeFileSync(path.join(outDir, 'web-login.png'), Buffer.from(png, 'base64')));
    await web.findElement(By.css('[data-testid="web-login-submit"]')).click();
    await web.wait(until.elementLocated(By.css('[data-testid="dag-status"]')), 10000);
    await web.takeScreenshot().then((png) => fs.writeFileSync(path.join(outDir, 'web-architect.png'), Buffer.from(png, 'base64')));
  } finally {
    await web.quit();
  }

  if (process.env.SKIP_MOBILE_SCREENSHOTS === '1') return;
  const appium = await createAppiumSession(process.env.APPIUM_SERVER_URL ?? 'http://127.0.0.1:4723', {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': process.env.APPIUM_DEVICE_NAME ?? 'Medium_Phone_API_35',
    'appium:app': path.resolve('mobile/app/build/outputs/apk/debug/app-debug.apk'),
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 120
  });
  try {
    await appium.screenshot(path.join(outDir, 'android-login.png'));
    await appium.tap('login-submit');
    await sleep(1200);
    await appium.tap('survey-card-customer-feedback');
    await sleep(1200);
    await appium.screenshot(path.join(outDir, 'android-survey.png'));
    await appium.tap('answer-q-channel-mobile');
    await sleep(600);
    await fetch('http://localhost:3001/api/test/delete-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'q-mobile-rating' })
    });
    await appium.tap('answer-q-mobile-rating-4');
    await sleep(1200);
    await appium.screenshot(path.join(outDir, 'android-conflict.png'));
  } finally {
    await appium.quit();
  }
});

console.log(`Screenshots written to ${outDir}`);
