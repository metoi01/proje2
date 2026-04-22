import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';

export const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    ...options
  });
  child.stdout.on('data', (data) => process.stdout.write(`[${args[1] ?? command}] ${data}`));
  child.stderr.on('data', (data) => process.stderr.write(`[${args[1] ?? command}] ${data}`));
  return child;
}

export async function waitForUrl(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function withServers(fn) {
  console.log('Starting backend and web dev servers...');
  const backend = spawnLogged(npmCmd, ['run', 'dev:backend'], { cwd: process.cwd() });
  const web = spawnLogged(npmCmd, ['run', 'dev:web'], { cwd: process.cwd() });
  try {
    await waitForUrl('http://localhost:3001/health');
    await waitForUrl('http://localhost:5173');
    console.log('Servers are ready.');
    await fetch('http://localhost:3001/api/test/reset', { method: 'POST' });
    return await fn();
  } finally {
    killTree(backend);
    killTree(web);
  }
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // process already ended
    }
  } else {
    child.kill('SIGTERM');
  }
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
