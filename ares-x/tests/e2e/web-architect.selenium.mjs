import assert from 'node:assert/strict';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import chromedriver from 'chromedriver';
import { withServers } from './_harness.mjs';

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
  console.log('Opening headless Chrome for Web Architect...');
  const options = new chrome.Options();
  options.addArguments('--headless=new', '--window-size=1440,1000');
  const service = new chrome.ServiceBuilder(chromedriver.path);
  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).setChromeService(service).build();
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

    await setTestValue(driver, 'edge-from', 'q-channel');
    await setTestValue(driver, 'edge-to', 'q-selenium-audit-note');
    await setTestValue(driver, 'edge-kind', 'equals');
    await setTestValue(driver, 'edge-value', 'mobile');
    await driver.findElement(By.css('[data-testid="add-edge"]')).click();
    await driver.wait(async () => {
      const rows = await driver.findElements(By.css('[data-testid^="edge-e-q-channel-q-selenium-audit-note"]'));
      return rows.length > 0 && (await rows[0].getText()).includes('equals mobile');
    }, 10000);

    await driver.executeScript(() => {
      const select = document.querySelector('[data-testid="preview-q-channel"] select');
      if (!select) throw new Error('Missing q-channel preview selector');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, 'mobile');
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await driver.wait(async () => {
      const text = await driver.findElement(By.css('[data-testid="visible-path"]')).getText();
      return text.includes('q-selenium-audit-note');
    }, 10000);

    const sendState = await driver.findElement(By.css('[data-testid="send-state"]')).getText();
    assert.match(sendState, /blocked/);

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
