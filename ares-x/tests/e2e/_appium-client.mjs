import fs from 'node:fs';

export async function createAppiumSession(server, capabilities) {
  const effectiveCapabilities = {
    'appium:uiautomator2ServerLaunchTimeout': 120000,
    'appium:uiautomator2ServerInstallTimeout': 120000,
    'appium:androidInstallTimeout': 120000,
    'appium:appWaitDuration': 120000,
    ...capabilities
  };

  const response = await fetch(`${server}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: effectiveCapabilities,
        firstMatch: [{}]
      }
    })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(json));
  const sessionId = json.value.sessionId ?? json.sessionId;

  async function command(method, path, body) {
    const res = await fetch(`${server}/session/${sessionId}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data.value;
  }

  function unwrapElement(value) {
    return value?.['element-6066-11e4-a52e-4f735466cecf'] ?? value?.ELEMENT;
  }

  async function scrollToAccessibilityId(accessibilityId) {
    const escapedId = accessibilityId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const value = await command('POST', '/element', {
      using: '-android uiautomator',
      value: `new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("${escapedId}"))`
    });
    return unwrapElement(value);
  }

  async function elementId(accessibilityId, timeoutMs = 15000) {
    const started = Date.now();
    let lastError;
    let scrollAttempted = false;
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await command('POST', '/element', { using: 'accessibility id', value: accessibilityId });
        return unwrapElement(value);
      } catch (error) {
        lastError = error;
        const message = String(error?.message ?? error);
        if (!message.includes('no such element') && !message.includes('stale element reference')) throw error;
        if (!scrollAttempted && message.includes('no such element')) {
          scrollAttempted = true;
          try {
            return await scrollToAccessibilityId(accessibilityId);
          } catch (scrollError) {
            lastError = scrollError;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    throw lastError;
  }

  async function retryStale(action) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        lastError = error;
        if (!String(error?.message ?? error).includes('stale element reference')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    throw lastError;
  }

  return {
    async exists(accessibilityId, timeoutMs = 5000) {
      try {
        await elementId(accessibilityId, timeoutMs);
        return true;
      } catch {
        return false;
      }
    },
    async tap(accessibilityId, timeoutMs = 15000) {
      await retryStale(async () => {
        const id = await elementId(accessibilityId, timeoutMs);
        await command('POST', `/element/${id}/click`, {});
      });
    },
    async type(accessibilityId, value, timeoutMs = 15000) {
      await retryStale(async () => {
        const id = await elementId(accessibilityId, timeoutMs);
        await command('POST', `/element/${id}/click`, {});
        await command('POST', `/element/${id}/clear`, {});
        await command('POST', `/element/${id}/value`, { text: value, value: Array.from(value) });
      });
    },
    async text(accessibilityId, timeoutMs = 15000) {
      return retryStale(async () => {
        const id = await elementId(accessibilityId, timeoutMs);
        return command('GET', `/element/${id}/text`);
      });
    },
    async enabled(accessibilityId, timeoutMs = 15000) {
      return retryStale(async () => {
        const id = await elementId(accessibilityId, timeoutMs);
        return command('GET', `/element/${id}/enabled`);
      });
    },
    async selected(accessibilityId, timeoutMs = 15000) {
      return retryStale(async () => {
        const id = await elementId(accessibilityId, timeoutMs);
        return command('GET', `/element/${id}/selected`);
      });
    },
    async attribute(accessibilityId, name, timeoutMs = 15000) {
      return retryStale(async () => {
        const id = await elementId(accessibilityId, timeoutMs);
        return command('GET', `/element/${id}/attribute/${name}`);
      });
    },
    async screenshot(filePath) {
      const base64 = await command('GET', '/screenshot');
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    },
    async source() {
      return command('GET', '/source');
    },
    async quit() {
      await fetch(`${server}/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
  };
}
