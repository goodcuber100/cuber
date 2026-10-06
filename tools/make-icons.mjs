#!/usr/bin/env node
// Renders the master app icon (icons/icon.svg) to the PNGs the web app manifest and
// index.html point at, using Playwright's Chromium.
//   npm run icons
// Uses a local `playwright` package when there is one, otherwise the global install.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');

// full: square, opaque navy tile (Android masks it, iOS rounds it itself).
// scale shrinks the art so it stays inside the maskable safe zone (a circle of 80% diameter).
const OUT = [
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-192.png', size: 192 },
  { file: 'favicon-32.png', size: 32 },
  { file: 'icon-maskable-512.png', size: 512, full: true, scale: 0.88 },
  { file: 'apple-touch-icon.png', size: 180, full: true, scale: 0.92 },
];

async function loadPlaywright() {
  try { return await import('playwright'); } catch (e) { /* not installed locally */ }
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return import(pathToFileURL(path.join(g, 'playwright', 'index.mjs')).href);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const o of OUT) {
    await page.setViewportSize({ width: o.size, height: o.size });
    const full = o.full ? `.tile{rx:0}.art{transform-origin:256px 256px;transform:scale(${o.scale})}` : '';
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${o.size}px;height:${o.size}px}${full}</style>${svg}`);
    await page.screenshot({ path: path.join(dir, o.file), omitBackground: !o.full });
    console.log(`icons/${o.file} (${o.size}×${o.size})`);
  }
} finally {
  await browser.close();
}
