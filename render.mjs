// Renders news.html to entry.png: headless Chromium over CDP.
// Run from this directory: node render.mjs
// The VM's Chromium has no internet, so the page loads from a file:// URL
// (localhost navigation is blocked). The image WebGL policy file allows all
// origins; the workspace copy allows none, so it must not be used here.
import { WebSocket } from 'ws';
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = 9231;
const SIZE = 1024;
const POLICY = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const POLICY_SHA = '8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6';
const PAGE = `file://${join(DIR, 'news.html')}`;
const OUT = join(DIR, 'entry.png');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome() {
  try {
    execSync(`pkill -f 'remote-debugging-port=${PORT}'`);
    await wait(500);
  } catch { /* nothing to kill */ }
  return spawn('/opt/meta-chromium/chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, '--allow-file-access-from-files',
    `--hatch-webgl-allowed-domains-file=${POLICY}`,
    `--hatch-webgl-allowed-domains-sha256=${POLICY_SHA}`,
    'about:blank',
  ], { stdio: 'ignore' });
}

async function devToolsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await wait(500);
  }
  throw new Error('DevTools endpoint did not come up');
}

async function main() {
  const chrome = await launchChrome();
  const ws = new WebSocket(await devToolsUrl());
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  let nextId = 0;
  const waiting = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  try {
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    await call('Page.enable', {}, sessionId);
    await call('Emulation.setDeviceMetricsOverride', {
      width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await call('Page.navigate', { url: PAGE }, sessionId);
    await wait(2500);
    const { data } = await call('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true,
    }, sessionId);
    writeFileSync(OUT, Buffer.from(data, 'base64'));
    console.log('rendered:', OUT);
  } finally {
    ws.close();
    chrome.kill();
  }
  process.exit(0);
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
