import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error('Chrome or Edge executable was not found for PDF generation.');

const reportHtml = path.resolve('docs/report.html');
const reportPdf = path.resolve('docs/report.pdf');
const result = spawnSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--allow-file-access-from-files',
  `--print-to-pdf=${reportPdf}`,
  `file:///${reportHtml.replace(/\\/g, '/')}`
], { stdio: 'inherit' });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Report written to ${reportPdf}`);
