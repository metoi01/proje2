#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(projectRoot, '..');
const mobileRoot = path.join(projectRoot, 'mobile');
const mobileApk = path.join(mobileRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const exe = isWindows ? '.exe' : '';
const cmdExt = isWindows ? '.cmd' : '';
const batExt = isWindows ? '.bat' : '';
const env = { ...process.env };
const managed = [];
let cleanupStarted = false;
let launchedEmulatorSerial = null;

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check') || args.has('--dry-run');
const runTestsMode = args.has('--run-tests') || args.has('--test') || args.has('--tests');
const verboseTestOutput = args.has('--verbose') || env.ARES_X_TEST_VERBOSE === '1';
const noInstall = args.has('--no-install') || env.ARES_X_NO_INSTALL === '1';
const skipAndroid = args.has('--skip-android') || env.ARES_X_SKIP_ANDROID === '1';
const skipAppium = args.has('--skip-appium') || env.ARES_X_SKIP_APPIUM === '1';
let suppressRoutineLogs = false;
let activeQuietLogFile = null;
let currentTestRunDir = null;

function log(message = '', options = {}) {
  if (suppressRoutineLogs && !options.force) return;
  console.log(message);
}

function section(title, options = {}) {
  if (suppressRoutineLogs && !options.force) return;
  log('', options);
  log(`== ${title} ==`, options);
}

function warn(message, options = {}) {
  log(`[warn] ${message}`, options);
}

function fail(message) {
  throw new Error(message);
}

function exists(target) {
  return Boolean(target && fs.existsSync(target));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function appendToActiveLog(message = '') {
  if (!activeQuietLogFile) return;
  ensureDir(path.dirname(activeQuietLogFile));
  fs.appendFileSync(activeQuietLogFile, message, 'utf8');
}

function quoteForDisplay(value) {
  return value.includes(' ') ? `"${value}"` : value;
}

function commandName(base) {
  return isWindows ? `${base}.cmd` : base;
}

function executableName(base) {
  return isWindows ? `${base}.exe` : base;
}

function projectBin(base) {
  return path.join(projectRoot, 'node_modules', '.bin', commandName(base));
}

function pathCandidatesForCommand(name) {
  const hasExt = path.extname(name) !== '';
  const exts = isWindows
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [];
  for (const dir of dirs) {
    if (hasExt) {
      candidates.push(path.join(dir, name));
    } else {
      for (const ext of exts) candidates.push(path.join(dir, `${name}${ext}`));
    }
  }
  return candidates;
}

function findCommand(names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    if (path.isAbsolute(name) && exists(name)) return name;
    for (const candidate of pathCandidatesForCommand(name)) {
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function prependPath(...entries) {
  const valid = entries.filter(Boolean).filter(exists);
  if (!valid.length) return;
  env.PATH = [...valid, env.PATH || ''].join(path.delimiter);
}

function runCapture(command, commandArgs = [], options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || projectRoot,
    env: options.env || env,
    encoding: 'utf8',
    shell: isWindows,
    maxBuffer: 1024 * 1024 * 10
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error
  };
}

function run(command, commandArgs = [], options = {}) {
  const display = [quoteForDisplay(command), ...commandArgs.map(quoteForDisplay)].join(' ');
  const quiet = options.quiet ?? suppressRoutineLogs;
  const shouldCapture = Boolean(options.capture || quiet || options.logFile);
  if (!quiet) log(`$ ${display}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || projectRoot,
    env: options.env || env,
    stdio: shouldCapture ? 'pipe' : 'inherit',
    encoding: shouldCapture ? 'utf8' : undefined,
    shell: isWindows,
    maxBuffer: 1024 * 1024 * 20
  });
  if (shouldCapture) {
    const output = [`$ ${display}`, result.stdout || '', result.stderr || ''].filter(Boolean).join('\n');
    const logFile = options.logFile || activeQuietLogFile;
    if (logFile) {
      ensureDir(path.dirname(logFile));
      fs.appendFileSync(logFile, `${output}\n`, 'utf8');
    }
  }
  if (result.status !== 0 && !options.allowFail) {
    fail(`Command failed: ${display}`);
  }
  return result;
}

async function runWithInput(command, commandArgs, input, options = {}) {
  const display = [quoteForDisplay(command), ...commandArgs.map(quoteForDisplay)].join(' ');
  const quiet = options.quiet ?? suppressRoutineLogs;
  const captureOutput = Boolean(quiet || options.logFile);
  if (!quiet) log(`$ ${display}`);
  return new Promise((resolve, reject) => {
    let timer = null;
    let stdout = '';
    let stderr = '';
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || projectRoot,
      env: options.env || env,
      shell: isWindows,
      stdio: captureOutput ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit']
    });
    if (captureOutput) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        warn(`Timed out waiting for: ${display}`);
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }
    child.stdin.end(input);
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (captureOutput) {
        const output = [`$ ${display}`, stdout, stderr].filter(Boolean).join('\n');
        const logFile = options.logFile || activeQuietLogFile;
        if (logFile) {
          ensureDir(path.dirname(logFile));
          fs.appendFileSync(logFile, `${output}\n`, 'utf8');
        }
      }
      if (code !== 0 && !options.allowFail) {
        reject(new Error(`Command failed: ${display}`));
      } else {
        resolve({ status: code, stdout, stderr });
      }
    });
  });
}

function pipeOutput(label, stream) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      if (shouldSuppressManagedLine(label, line)) continue;
      appendToActiveLog(`[${label}] ${line}\n`);
      log(`[${label}] ${line}`);
    }
  });
  stream.on('end', () => {
    if (buffer.trim() && !shouldSuppressManagedLine(label, buffer)) {
      appendToActiveLog(`[${label}] ${buffer}\n`);
      log(`[${label}] ${buffer}`);
    }
  });
}

function shouldSuppressManagedLine(label, line) {
  if (label !== 'emulator') return false;
  return [
    /QMetaObject::connectSlotsByName/,
    /QObject::connect:/,
    /skipping QEventPoint/,
    /no target window/
  ].some((pattern) => pattern.test(line));
}

function spawnManaged(label, command, commandArgs = [], options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd || projectRoot,
    env: options.env || env,
    shell: isWindows,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  managed.push({ label, child });
  pipeOutput(label, child.stdout);
  pipeOutput(label, child.stderr);
  child.on('error', (error) => warn(`${label} failed to start: ${error.message}`));
  child.on('exit', (code, signal) => {
    if (!cleanupStarted) {
      warn(`${label} exited unexpectedly (${signal || code}).`);
    }
  });
  return child;
}

async function cleanupAndExit(code) {
  if (cleanupStarted) return;
  cleanupStarted = true;
  section('Shutting down');
  if (launchedEmulatorSerial && tools.adb) {
    run(tools.adb, ['-s', launchedEmulatorSerial, 'emu', 'kill'], { allowFail: true });
  }
  for (const { label, child } of [...managed].reverse()) {
    if (!child.pid) continue;
    log(`Stopping ${label}...`);
    if (isWindows) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // Best effort shutdown.
        }
      }
    }
  }
  await delay(1200);
  if (!isWindows) {
    for (const { child } of managed) {
      if (!child.pid || child.exitCode !== null) continue;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Process already exited.
      }
    }
  }
  log('All processes opened by this launcher were stopped.');
  process.exit(code);
}

process.on('SIGINT', () => cleanupAndExit(130));
process.on('SIGTERM', () => cleanupAndExit(143));
process.on('SIGHUP', () => cleanupAndExit(129));

function localIps() {
  const ips = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) ips.push(address.address);
    }
  }
  return ips;
}

function httpGet(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { timeout: 2000 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await httpGet(url)) return true;
    await delay(1000);
  }
  return false;
}

async function assertRuntimeHealth(context) {
  const stage = context ? ` after ${context}` : '';
  if (!(await waitForHttp('http://127.0.0.1:3001/health', 5000))) {
    fail(`Backend stopped responding${stage}.`);
  }
  if (!(await waitForHttp('http://127.0.0.1:5173', 5000))) {
    fail(`Web app stopped responding${stage}.`);
  }
}

function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 700 });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

function printUrls() {
  section('Ready');
  log('Backend:');
  log('  Local: http://localhost:3001/health');
  for (const ip of localIps()) log(`  LAN:   http://${ip}:3001/health`);
  log('Web Architect:');
  log('  Local: http://localhost:5173');
  for (const ip of localIps()) log(`  LAN:   http://${ip}:5173`);
  log('Android emulator backend URL: http://10.0.2.2:3001');
  log('Appium: http://127.0.0.1:4723');
  log('');
  log('Demo accounts:');
  log('  Web admin: admin@ares.test / Admin123!');
  log('  Mobile:    alice@ares.test / Test1234!');
  log('');
  log('Keep this terminal open while using the project.');
  log('Press Ctrl-C or close this terminal to stop everything this launcher opened.');
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds.toFixed(1)}s`;
}

function timestampTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sanitizeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

function decodeJsonStringLiteral(value) {
  try {
    return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  } catch {
    return value.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function extractFailureReason(output) {
  const clean = stripAnsi(output || '');
  const jsonMessageMatches = [...clean.matchAll(/"message":"((?:\\.|[^"])*)"/g)];
  if (jsonMessageMatches.length) {
    const message = decodeJsonStringLiteral(jsonMessageMatches.at(-1)[1]).trim();
    if (message) return message;
  }

  const assertionLine = clean.match(/AssertionError(?: \[[^\]]+\])?: ([^\n]+)/);
  if (assertionLine && assertionLine[1] && assertionLine[1] !== 'Expected values to be strictly equal:') {
    return assertionLine[1].trim();
  }

  if (clean.includes('Expected values to be strictly equal')) {
    const equalDiff = clean.match(/'([^']*)'\s*!==\s*'([^']*)'/);
    if (equalDiff) {
      return `Assertion failed: expected '${equalDiff[2]}' but got '${equalDiff[1]}'`;
    }
    return 'Assertion failed: expected values to be strictly equal';
  }

  const errorLine = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('Error: '));
  if (errorLine) return errorLine.replace(/^Error:\s*/, '').trim();

  const tail = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return tail || 'Unknown failure';
}

function listFilesRecursive(rootDir, predicate) {
  if (!exists(rootDir)) return [];

  const files = [];

  function visit(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(entry.name, fullPath)) {
        files.push(fullPath);
      }
    }
  }

  visit(rootDir);
  return files.sort((left, right) => left.localeCompare(right));
}

function toProjectRelative(target) {
  return path.relative(projectRoot, target).split(path.sep).join('/');
}

function discoverUnitSuites() {
  const unitDir = path.join(projectRoot, 'tests', 'unit');
  const vitest = tools.vitest && exists(tools.vitest) ? tools.vitest : null;
  const npx = tools.npx || commandName('npx');

  return listFilesRecursive(unitDir, (name) => name.endsWith('.test.ts')).map((filePath) => {
    const relativePath = toProjectRelative(filePath);
    return {
      id: relativePath,
      name: relativePath,
      command: vitest || npx,
      args: vitest
        ? ['run', '--config', 'vitest.config.ts', relativePath]
        : ['vitest', 'run', '--config', 'vitest.config.ts', relativePath]
    };
  });
}

function discoverE2eSuites() {
  const e2eDir = path.join(projectRoot, 'tests', 'e2e');
  if (!exists(e2eDir)) return [];
  const preferredOrder = [
    'mobile.appium.mjs',
    'cross-platform-consistency.mjs',
    'sync-conflict.mjs',
    'web-architect.selenium.mjs'
  ];
  const rank = new Map(preferredOrder.map((name, index) => [name, index]));
  return fs.readdirSync(e2eDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.mjs') && !name.startsWith('_'))
    .sort((left, right) => {
      const leftRank = rank.has(left) ? rank.get(left) : Number.MAX_SAFE_INTEGER;
      const rightRank = rank.has(right) ? rank.get(right) : Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.localeCompare(right);
    })
    .map((name) => ({
      id: `tests/e2e/${name}`,
      name: `tests/e2e/${name}`,
      command: process.execPath,
      args: [path.join('tests', 'e2e', name)]
    }));
}

function printDiscoveredTests(testSuites) {
  if (!testSuites.length) {
    warn('No test suites were discovered.', { force: true });
    return;
  }
  for (const suite of testSuites) {
    log(`[PENDING] ${suite.name}`, { force: true });
  }
}

function suiteLogFile(suiteName) {
  if (!currentTestRunDir) return null;
  return path.join(currentTestRunDir, `${sanitizeFilePart(suiteName)}.log`);
}

async function runStatusStep(name, action) {
  const started = Date.now();
  const quiet = !verboseTestOutput;
  const previousSuppression = suppressRoutineLogs;
  const previousLogFile = activeQuietLogFile;
  const logFile = quiet ? suiteLogFile(name) : null;

  if (logFile) {
    ensureDir(path.dirname(logFile));
    fs.writeFileSync(logFile, '', 'utf8');
  }

  log(`[RUNNING] ${name}`, { force: true });
  if (quiet) {
    suppressRoutineLogs = true;
    activeQuietLogFile = logFile;
  }

  try {
    await action();
    const duration = Date.now() - started;
    log(`[PASS] ${name} (${formatDuration(duration)})`, { force: true });
    return { name, status: 0, duration, logFile };
  } catch (error) {
    const duration = Date.now() - started;
    const loggedOutput = logFile && exists(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    const failureText = `${error?.stack || error?.message || String(error)}\n${loggedOutput}`;
    const reason = extractFailureReason(failureText);
    log(`[FAIL] ${name} (${formatDuration(duration)}) - ${reason}`, { force: true });
    return { name, status: 1, duration, reason, logFile };
  } finally {
    suppressRoutineLogs = previousSuppression;
    activeQuietLogFile = previousLogFile;
  }
}

function runNamedCommand(suite, options = {}) {
  const started = Date.now();
  const quiet = !verboseTestOutput;
  const logFile = quiet ? suiteLogFile(suite.name) : null;
  if (logFile) {
    ensureDir(path.dirname(logFile));
    fs.writeFileSync(logFile, '', 'utf8');
  }

  log(`[RUNNING] ${suite.name}`, { force: true });
  const result = run(suite.command, suite.args, {
    ...options,
    allowFail: true,
    quiet,
    logFile
  });
  const status = result.status ?? 1;
  const duration = Date.now() - started;
  if (status === 0) {
    log(`[PASS] ${suite.name} (${formatDuration(duration)})`, { force: true });
    return { name: suite.name, status, duration, logFile };
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const reason = extractFailureReason(output);
  log(`[FAIL] ${suite.name} (${formatDuration(duration)}) - ${reason}`, { force: true });
  return { name: suite.name, status, duration, reason, logFile };
}

function printTestSummary(results) {
  const passed = results.filter((result) => result.status === 0).length;
  const failed = results.length - passed;
  log(`[TOTAL] ${passed} passed, ${failed} failed`, { force: true });
  const failedLogs = results.filter((result) => result.status !== 0 && result.logFile);
  if (failedLogs.length) {
    for (const result of failedLogs) {
      log(`[DETAIL] ${result.name} log: ${toProjectRelative(result.logFile)}`, { force: true });
    }
  }
}

async function runAllTests() {
  currentTestRunDir = path.join(projectRoot, 'artifacts', 'test-runs', timestampTag());
  ensureDir(currentTestRunDir);
  log('[START] Running all tests under ares-x/tests', { force: true });

  const unitSuites = discoverUnitSuites();
  const e2eSuites = discoverE2eSuites();
  const plannedSuites = [...unitSuites, ...e2eSuites];
  printDiscoveredTests(plannedSuites);

  const results = [];

  if (!unitSuites.length) {
    warn('No unit test files were found under tests/unit.', { force: true });
  } else {
    for (const suite of unitSuites) {
      results.push(runNamedCommand(suite, { cwd: projectRoot, env }));
    }
  }

  if (!e2eSuites.length) {
    warn('No E2E suites were found under tests/e2e.', { force: true });
  } else {
    const preflight = await runStatusStep('test-environment', async () => {
      await ensureAppium();
      await buildAndRunAndroid();
    });
    if (preflight.status !== 0) {
      printTestSummary(results);
      return 1;
    }

    for (const suite of e2eSuites) {
      await delay(3500);
      results.push(runNamedCommand(suite, { cwd: projectRoot, env }));
    }
  }

  printTestSummary(results);
  return results.every((result) => result.status === 0) ? 0 : 1;
}

function requireNode18() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    fail(`Node.js 18+ is required. Current version is ${process.version}. Please install Node.js LTS and run again.`);
  }
}

function maybeInstallWithBrew(packages, cask = false) {
  const brew = findCommand('brew');
  if (!brew) return false;
  if (noInstall) return false;
  run(brew, ['install', ...(cask ? ['--cask'] : []), ...packages], { allowFail: true });
  return true;
}

function maybeInstallWithWinget(id) {
  const winget = findCommand('winget');
  if (!winget || noInstall) return false;
  run(winget, ['install', '--id', id, '-e', '--accept-package-agreements', '--accept-source-agreements'], { allowFail: true });
  return true;
}

function maybeInstallWithChoco(packageName) {
  const choco = findCommand('choco');
  if (!choco || noInstall) return false;
  run(choco, ['install', packageName, '-y'], { allowFail: true });
  return true;
}

function ensureNpmDependencies() {
  section('Node packages');
  const npm = findCommand(commandName('npm')) || commandName('npm');
  const npx = findCommand(commandName('npx')) || commandName('npx');
  tools.npm = npm;
  tools.npx = npx;
  const localBinDir = path.join(projectRoot, 'node_modules', '.bin');
  prependPath(localBinDir);
  repairLocalBinPermissions(localBinDir);

  const localVite = projectBin('vite');
  const localTsx = projectBin('tsx');
  const viteCheck = exists(localVite) ? runCapture(localVite, ['--version']) : { ok: false };
  const tsxCheck = exists(localTsx) ? runCapture(localTsx, ['--version']) : { ok: false };
  if (!exists(path.join(projectRoot, 'node_modules')) || !viteCheck.ok || !tsxCheck.ok) {
    if (noInstall) fail('npm packages are missing, and auto-install is disabled.');
    run(npm, ['install'], { cwd: projectRoot });
  } else {
    log('npm packages are already usable.');
  }

  repairLocalBinPermissions(localBinDir);
  tools.vite = exists(localVite) ? localVite : null;
  tools.tsx = exists(localTsx) ? localTsx : null;
  tools.appium = exists(projectBin('appium')) ? projectBin('appium') : null;
  tools.vitest = exists(projectBin('vitest')) ? projectBin('vitest') : null;
}

function repairLocalBinPermissions(localBinDir) {
  if (isWindows || !exists(localBinDir)) return;

  let repaired = 0;
  for (const entry of fs.readdirSync(localBinDir, { withFileTypes: true })) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (entry.name.endsWith('.cmd') || entry.name.endsWith('.ps1')) continue;
    const target = path.join(localBinDir, entry.name);
    try {
      const stat = fs.statSync(target);
      const executable = (stat.mode & 0o111) !== 0;
      if (!executable) {
        fs.chmodSync(target, stat.mode | 0o755);
        repaired += 1;
      }
    } catch {
      // Ignore broken optional package links; npm will recreate them when needed.
    }
  }

  if (repaired) log(`Fixed executable permission on ${repaired} npm bin file(s).`);
}

function detectAndroidStudioJbr() {
  const candidates = [];
  if (isMac) {
    candidates.push('/Applications/Android Studio.app/Contents/jbr/Contents/Home');
    candidates.push('/Applications/Android Studio.app/Contents/jre/Contents/Home');
    candidates.push('/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home');
    candidates.push('/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home');
  } else if (isWindows) {
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    candidates.push(path.join(programFiles, 'Android', 'Android Studio', 'jbr'));
    candidates.push(path.join(programFiles, 'Android', 'Android Studio', 'jre'));
    candidates.push(path.join(programFiles, 'Eclipse Adoptium'));
  }
  for (const candidate of candidates) {
    if (!exists(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (stat.isDirectory() && exists(path.join(candidate, 'bin', executableName('java')))) return candidate;
    if (stat.isDirectory()) {
      const nested = fs.readdirSync(candidate, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(candidate, entry.name, 'bin', executableName('java')))
        .find(exists);
      if (nested) return path.dirname(path.dirname(nested));
    }
  }
  return null;
}

function ensureJava() {
  section('Java');
  if (env.JAVA_HOME && exists(path.join(env.JAVA_HOME, 'bin', executableName('java')))) {
    prependPath(path.join(env.JAVA_HOME, 'bin'));
    log(`Using JAVA_HOME=${env.JAVA_HOME}`);
    return true;
  }

  const jbr = detectAndroidStudioJbr();
  if (jbr) {
    env.JAVA_HOME = jbr;
    prependPath(path.join(jbr, 'bin'));
    log(`Using detected JDK: ${jbr}`);
    return true;
  }

  const java = findCommand(executableName('java'));
  if (java) {
    log(`Using Java on PATH: ${java}`);
    return true;
  }

  warn('Java 17 was not found.');
  if (isMac) {
    maybeInstallWithBrew(['openjdk@17']);
  } else if (isWindows) {
    maybeInstallWithWinget('EclipseAdoptium.Temurin.17.JDK') || maybeInstallWithChoco('temurin17');
  }

  const installed = detectAndroidStudioJbr();
  if (installed) {
    env.JAVA_HOME = installed;
    prependPath(path.join(installed, 'bin'));
    log(`Using installed JDK: ${installed}`);
    return true;
  }
  if (findCommand(executableName('java'))) return true;
  warn('Java is still missing; Android build may be skipped.');
  return false;
}

function commonAndroidSdkPaths() {
  if (isMac) return [path.join(os.homedir(), 'Library', 'Android', 'sdk')];
  if (isWindows) return [path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Android', 'Sdk')];
  return [path.join(os.homedir(), 'Android', 'Sdk')];
}

function findInAndroidSdk(sdk, relative) {
  const target = path.join(sdk, ...relative);
  return exists(target) ? target : null;
}

function findAndroidTool(sdk, name) {
  const file = isWindows ? `${name}.bat` : name;
  const exeFile = isWindows ? `${name}.exe` : name;
  const candidates = [
    findInAndroidSdk(sdk, ['cmdline-tools', 'latest', 'bin', file]),
    findInAndroidSdk(sdk, ['cmdline-tools', 'bin', file]),
    findInAndroidSdk(sdk, ['tools', 'bin', file]),
    findInAndroidSdk(sdk, ['platform-tools', exeFile]),
    findInAndroidSdk(sdk, ['emulator', exeFile])
  ].filter(Boolean);
  return candidates[0] || findCommand([file, exeFile, name]);
}

async function ensureAndroidSdk() {
  section('Android SDK');
  let sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || null;
  if (!sdk || !exists(sdk)) {
    sdk = commonAndroidSdkPaths().find(exists) || null;
  }

  if (!sdk) {
    warn('Android SDK was not found.');
    if (isMac) {
      maybeInstallWithBrew(['android-studio'], true);
    } else if (isWindows) {
      maybeInstallWithWinget('Google.AndroidStudio') || maybeInstallWithChoco('androidstudio');
    }
    sdk = commonAndroidSdkPaths().find(exists) || null;
  }

  if (!sdk) {
    warn('Android SDK is still missing. Install/open Android Studio once so it can create the SDK.');
    return null;
  }

  env.ANDROID_HOME = sdk;
  env.ANDROID_SDK_ROOT = sdk;
  prependPath(
    path.join(sdk, 'platform-tools'),
    path.join(sdk, 'emulator'),
    path.join(sdk, 'cmdline-tools', 'latest', 'bin'),
    path.join(sdk, 'tools', 'bin')
  );

  const sdkmanager = findAndroidTool(sdk, 'sdkmanager');
  if (sdkmanager && !noInstall) {
    log(`Using Android SDK: ${sdk}`);
    await runWithInput(sdkmanager, ['--licenses'], 'y\n'.repeat(80), { allowFail: true, timeoutMs: 180000 });
    await runWithInput(
      sdkmanager,
      ['platform-tools', 'emulator', 'platforms;android-35', 'build-tools;35.0.0'],
      'y\n'.repeat(80),
      { allowFail: true, timeoutMs: 300000 }
    );
  } else {
    log(`Using Android SDK: ${sdk}`);
    if (!sdkmanager) warn('sdkmanager was not found; package auto-install is unavailable.');
  }

  return {
    sdk,
    adb: findAndroidTool(sdk, 'adb') || findCommand(executableName('adb')),
    emulator: findAndroidTool(sdk, 'emulator') || findCommand(executableName('emulator')),
    sdkmanager,
    avdmanager: findAndroidTool(sdk, 'avdmanager')
  };
}

function findGradleInCache() {
  const base = path.join(os.homedir(), '.gradle', 'wrapper', 'dists');
  const binary = isWindows ? 'gradle.bat' : 'gradle';
  const stack = exists(base) ? [base] : [];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name === binary && full.includes(`${path.sep}bin${path.sep}`)) return full;
    }
  }
  return null;
}

function ensureGradle() {
  section('Gradle');
  const wrapper = path.join(mobileRoot, isWindows ? 'gradlew.bat' : 'gradlew');
  if (exists(wrapper)) {
    log(`Using Gradle wrapper: ${wrapper}`);
    return wrapper;
  }
  const onPath = findCommand(isWindows ? 'gradle.bat' : 'gradle');
  if (onPath) {
    log(`Using Gradle on PATH: ${onPath}`);
    return onPath;
  }
  const cached = findGradleInCache();
  if (cached) {
    log(`Using Gradle from wrapper cache: ${cached}`);
    return cached;
  }

  warn('Gradle was not found.');
  if (isMac) {
    maybeInstallWithBrew(['gradle']);
  } else if (isWindows) {
    maybeInstallWithWinget('Gradle.Gradle') || maybeInstallWithChoco('gradle');
  }

  return findCommand(isWindows ? 'gradle.bat' : 'gradle') || findGradleInCache();
}

function adbDevices(adb) {
  if (!adb) return [];
  const result = runCapture(adb, ['devices']);
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\tdevice$/.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

function emulatorAvds(emulator) {
  if (!emulator) return [];
  const result = runCapture(emulator, ['-list-avds']);
  if (!result.ok) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function createAvdIfNeeded(android) {
  if (!android.sdkmanager || !android.avdmanager || noInstall) return false;
  const arch = isMac && process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  const image = `system-images;android-35;google_apis;${arch}`;
  log(`Preparing Android emulator image: ${image}`);
  await runWithInput(android.sdkmanager, [image], 'y\n'.repeat(120), { allowFail: true, timeoutMs: 600000 });
  await runWithInput(android.avdmanager, ['create', 'avd', '-n', 'ARES_X_API_35', '-k', image, '-d', 'pixel_6', '--force'], 'no\n', { allowFail: true });
  return true;
}

async function waitForBoot(adb, knownDevices) {
  const start = Date.now();
  let serial = null;
  while (Date.now() - start < 180000) {
    const devices = adbDevices(adb);
    serial = devices.find((device) => !knownDevices.includes(device)) || devices[0] || null;
    if (serial) {
      const boot = runCapture(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
      if (boot.stdout.trim() === '1') return serial;
    }
    await delay(3000);
  }
  return serial;
}

async function ensureAndroidDevice(android) {
  if (!android.adb) {
    warn('adb was not found; Android APK cannot be installed automatically.');
    return null;
  }

  let devices = adbDevices(android.adb);
  if (devices.length) {
    log(`Using connected Android device/emulator: ${devices[0]}`);
    return devices[0];
  }

  if (!android.emulator) {
    warn('No Android device is connected and the emulator command was not found.');
    return null;
  }

  let avds = emulatorAvds(android.emulator);
  if (!avds.length) {
    await createAvdIfNeeded(android);
    avds = emulatorAvds(android.emulator);
  }
  if (!avds.length) {
    warn('No Android Virtual Device is available. Create one in Android Studio, then run this launcher again.');
    return null;
  }

  const avd = avds.includes('ARES_X_API_35') ? 'ARES_X_API_35' : avds[0];
  const before = adbDevices(android.adb);
  log(`Starting Android emulator: ${avd}`);
  spawnManaged('emulator', android.emulator, ['-avd', avd, '-netdelay', 'none', '-netspeed', 'full']);
  const serial = await waitForBoot(android.adb, before);
  if (serial) {
    launchedEmulatorSerial = serial;
    log(`Android emulator is ready: ${serial}`);
    return serial;
  }
  warn('Android emulator did not finish booting in time.');
  return null;
}

function installAndLaunchApk(adb, serial) {
  if (!exists(mobileApk)) {
    warn(`APK was not found: ${mobileApk}`);
    return;
  }
  const install = runCapture(adb, ['-s', serial, 'install', '-r', mobileApk], { cwd: projectRoot, env });
  const installOutput = `${install.stdout}${install.stderr}`;
  if (!install.ok && installOutput.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE')) {
    warn('Existing emulator app signature does not match the new debug build. Removing old app and retrying install.');
    run(adb, ['-s', serial, 'uninstall', 'edu.bilkent.aresx'], { allowFail: true });
    const retry = runCapture(adb, ['-s', serial, 'install', '-r', mobileApk], { cwd: projectRoot, env });
    if (!retry.ok) {
      warn((`${retry.stdout}${retry.stderr}` || 'APK reinstall failed.').trim());
      return;
    }
  } else if (!install.ok) {
    warn((installOutput || 'APK install failed.').trim());
    return;
  }
  run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', 'edu.bilkent.aresx/.MainActivity'], { allowFail: true });
}

async function buildAndRunAndroid() {
  if (skipAndroid) {
    warn('Android startup was skipped by flag/env.');
    return;
  }

  const javaOk = ensureJava();
  const android = await ensureAndroidSdk();
  tools.adb = android?.adb || null;
  const gradle = ensureGradle();

  if (javaOk && android?.sdk && gradle) {
    section('Android build');
    run(gradle, ['-p', 'mobile', 'assembleDebug', '-Pkotlin.incremental=false', '-Dkotlin.compiler.execution.strategy=in-process', '--no-daemon'], {
      cwd: projectRoot,
      env,
      allowFail: true
    });
  } else if (exists(mobileApk)) {
    warn('Using the existing debug APK because a full Android build toolchain is not available.');
  } else {
    warn('Android build was skipped because Java, Android SDK, or Gradle is missing.');
    return;
  }

  if (!android?.adb) {
    warn(`Debug APK is available at: ${mobileApk}`);
    return;
  }

  section('Android launch');
  const device = await ensureAndroidDevice(android);
  if (device) installAndLaunchApk(android.adb, device);
}

async function ensureAppium() {
  if (skipAppium) {
    warn('Appium startup was skipped by flag/env.');
    return;
  }

  section('Appium');
  repairAppiumDriverCache();
  if (await isPortBusy(4723)) {
    warn('Port 4723 is already in use; reusing the existing Appium service if it is Appium.');
    return;
  }

  const npx = tools.npx || commandName('npx');
  const list = runCapture(npx, ['appium', 'driver', 'list', '--installed', '--json']);
  if (!list.stdout.includes('uiautomator2')) {
    if (noInstall) {
      warn('uiautomator2 Appium driver is missing, and auto-install is disabled.');
    } else {
      run(npx, ['appium', 'driver', 'install', 'uiautomator2@4.2.9'], { allowFail: true });
    }
  }

  const appium = tools.appium && exists(tools.appium) ? tools.appium : npx;
  const appiumArgs = appium === npx
    ? ['appium', '--address', '127.0.0.1', '--port', '4723', '--base-path', '/']
    : ['--address', '127.0.0.1', '--port', '4723', '--base-path', '/'];

  spawnManaged('appium', appium, appiumArgs);
  const ready = await waitForHttp('http://127.0.0.1:4723/status', 45000);
  if (!ready) warn('Appium did not report ready status yet; Android app can still run without it.');
}

function repairAppiumDriverCache() {
  const cacheFile = path.join(projectRoot, 'node_modules', '.cache', 'appium', 'extensions.yaml');
  const driverPath = path.join(projectRoot, 'node_modules', 'appium-uiautomator2-driver');
  if (!exists(cacheFile) || !exists(driverPath)) return;

  const content = fs.readFileSync(cacheFile, 'utf8');
  if (!content.includes('appium-uiautomator2-driver')) return;

  const normalizedDriverPath = isWindows ? driverPath.replace(/\//g, '\\') : driverPath;
  const next = content.replace(/^(\s*installPath:\s*).+$/m, `$1${JSON.stringify(normalizedDriverPath)}`);
  if (next !== content) {
    fs.writeFileSync(cacheFile, next);
    log(`Repaired Appium uiautomator2 driver path: ${normalizedDriverPath}`);
  }
}

async function startBackendAndWeb() {
  section('Backend and web');
  const npm = tools.npm || commandName('npm');
  const tsx = tools.tsx && exists(tools.tsx) ? tools.tsx : null;
  const vite = tools.vite && exists(tools.vite) ? tools.vite : null;

  if (await isPortBusy(3001)) {
    if (await httpGet('http://127.0.0.1:3001/health')) {
      warn('Backend port 3001 is already serving ARES-X; reusing it.');
    } else {
      fail('Port 3001 is busy. Close the process using it, then run the launcher again.');
    }
  } else {
    spawnManaged(
      'backend',
      tsx || npm,
      tsx ? ['backend/src/server.ts'] : ['run', 'dev:backend'],
      { env: { ...env, PORT: '3001' } }
    );
  }

  if (!(await waitForHttp('http://127.0.0.1:3001/health', 45000))) {
    fail('Backend did not become ready on http://localhost:3001/health.');
  }

  if (await isPortBusy(5173)) {
    if (await httpGet('http://127.0.0.1:5173')) {
      warn('Web port 5173 is already serving a page; reusing it.');
    } else {
      fail('Port 5173 is busy. Close the process using it, then run the launcher again.');
    }
  } else {
    spawnManaged('web', vite || npm, vite ? ['--host', '0.0.0.0'] : ['run', 'dev:web'], { env });
  }

  if (!(await waitForHttp('http://127.0.0.1:5173', 45000))) {
    fail('Web app did not become ready on http://localhost:5173.');
  }
}

const tools = {
  appium: null,
  vitest: null,
  npm: null,
  npx: null,
  tsx: null,
  vite: null,
  adb: null
};

async function main() {
  const quietTestMode = runTestsMode && !verboseTestOutput;
  if (quietTestMode) suppressRoutineLogs = true;

  log('ARES-X Integrated Adaptive Survey Ecosystem', { force: true });
  log(`Project root: ${projectRoot}`, { force: true });
  requireNode18();
  ensureNpmDependencies();

  if (checkOnly) {
    section('Check complete');
    log('The launcher syntax and Node project dependencies look usable.');
    return;
  }

  if (runTestsMode) {
    const code = await runAllTests();
    suppressRoutineLogs = quietTestMode;
    await cleanupAndExit(code);
    return;
  }

  await startBackendAndWeb();
  await ensureAppium();
  await buildAndRunAndroid();
  await assertRuntimeHealth('Android launch');
  printUrls();

  process.stdin.resume();
  await new Promise(() => {});
}

main().catch(async (error) => {
  log('', { force: true });
  log(`[error] ${error.message}`, { force: true });
  await cleanupAndExit(1);
});
