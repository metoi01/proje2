import fs from 'node:fs';

export async function createAppiumSession(server, capabilities) {
  const response = await fetch(`${server}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: capabilities,
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

  async function elementId(accessibilityId, timeoutMs = 15000) {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await command('POST', '/element', { using: 'accessibility id', value: accessibilityId });
        return value['element-6066-11e4-a52e-4f735466cecf'] ?? value.ELEMENT;
      } catch (error) {
        lastError = error;
        const message = String(error?.message ?? error);
        if (!message.includes('no such element') && !message.includes('stale element reference')) throw error;
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
    async tap(accessibilityId) {
      await retryStale(async () => {
        const id = await elementId(accessibilityId);
        await command('POST', `/element/${id}/click`, {});
      });
    },
    async type(accessibilityId, value) {
      await retryStale(async () => {
        const id = await elementId(accessibilityId);
        await command('POST', `/element/${id}/click`, {});
        await command('POST', `/element/${id}/clear`, {});
        await command('POST', `/element/${id}/value`, { text: value, value: Array.from(value) });
      });
    },
    async text(accessibilityId) {
      return retryStale(async () => {
        const id = await elementId(accessibilityId);
        return command('GET', `/element/${id}/text`);
      });
    },
    async enabled(accessibilityId) {
      return retryStale(async () => {
        const id = await elementId(accessibilityId);
        return command('GET', `/element/${id}/enabled`);
      });
    },
    async selected(accessibilityId) {
      return retryStale(async () => {
        const id = await elementId(accessibilityId);
        return command('GET', `/element/${id}/selected`);
      });
    },
    async attribute(accessibilityId, name) {
      return retryStale(async () => {
        const id = await elementId(accessibilityId);
        return command('GET', `/element/${id}/attribute/${name}`);
      });
    },
    async screenshot(filePath) {
      const base64 = await command('GET', '/screenshot');
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    },
    async quit() {
      await fetch(`${server}/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
  };
}
