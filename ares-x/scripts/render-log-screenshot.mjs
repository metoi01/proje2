import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , inputLog, outputPng] = process.argv;

if (!inputLog || !outputPng) {
  console.error('Usage: node scripts/render-log-screenshot.mjs <input.log> <output.png>');
  process.exit(1);
}

const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chrome) {
  console.error('Chrome/Edge/Chromium executable was not found.');
  process.exit(1);
}

const absoluteLog = path.resolve(inputLog);
const absolutePng = path.resolve(outputPng);
const htmlPath = absolutePng.replace(/\.png$/i, '.html');
const log = fs.readFileSync(absoluteLog, 'utf8')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${path.basename(absoluteLog)}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        background: #0b1020;
        color: #d6deff;
        font: 15px/1.45 Menlo, Monaco, Consolas, monospace;
      }
      .frame {
        min-height: 100vh;
        padding: 24px;
      }
      .bar {
        margin-bottom: 14px;
        color: #7bdff6;
        font-weight: 700;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        border: 1px solid #21304f;
        border-radius: 10px;
        padding: 18px;
        background: #0f172a;
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28);
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="bar">${path.basename(absoluteLog)}</div>
      <pre>${log}</pre>
    </div>
  </body>
</html>
`;

fs.mkdirSync(path.dirname(absolutePng), { recursive: true });
fs.writeFileSync(htmlPath, html, 'utf8');

const result = spawnSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--allow-file-access-from-files',
  `--screenshot=${absolutePng}`,
  '--window-size=1600,1600',
  `file://${htmlPath}`
], { stdio: 'inherit' });

process.exit(result.status ?? 1);
