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

  async function elementId(accessibilityId) {
    const value = await command('POST', '/element', { using: 'accessibility id', value: accessibilityId });
    return value['element-6066-11e4-a52e-4f735466cecf'] ?? value.ELEMENT;
  }

  return {
    async tap(accessibilityId) {
      const id = await elementId(accessibilityId);
      await command('POST', `/element/${id}/click`, {});
    },
    async text(accessibilityId) {
      const id = await elementId(accessibilityId);
      return command('GET', `/element/${id}/text`);
    },
    async enabled(accessibilityId) {
      const id = await elementId(accessibilityId);
      return command('GET', `/element/${id}/enabled`);
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
