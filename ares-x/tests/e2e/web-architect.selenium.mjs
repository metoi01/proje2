import assert from 'node:assert/strict';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { withServers } from './_harness.mjs';

await withServers(async () => {
  console.log('Opening headless Chrome for Web Architect...');
  const options = new chrome.Options();
  options.addArguments('--headless=new', '--window-size=1440,1000');
  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  try {
    console.log('Navigating to Vite app...');
    await driver.get('http://localhost:5173');
    await driver.wait(until.elementLocated(By.css('[data-testid="web-login-email"]')), 10000);
    await driver.findElement(By.css('[data-testid="web-login-submit"]')).click();
    await driver.wait(until.elementLocated(By.css('[data-testid="dag-status"]')), 10000);

    const status = await driver.findElement(By.css('[data-testid="dag-status"]')).getText();
    assert.match(status, /DAG valid/);

    await driver.findElement(By.css('[data-testid="new-question-title"]')).sendKeys('Selenium audit note');
    await driver.findElement(By.css('[data-testid="add-question"]')).click();
    await driver.wait(until.elementLocated(By.css('[data-testid^="question-editor-q-selenium-audit-note"]')), 10000);

    const sendState = await driver.findElement(By.css('[data-testid="send-state"]')).getText();
    assert.match(sendState, /blocked|enabled/);

    await driver.findElement(By.css('[data-testid="publish-survey"]')).click();
    await driver.wait(async () => {
      const text = await driver.findElement(By.css('[data-testid="survey-customer-feedback"] small')).getText();
      return text.includes('v2');
    }, 10000);
  } finally {
    await driver.quit();
  }
});

console.log('Selenium Web Architect scenario passed.');
