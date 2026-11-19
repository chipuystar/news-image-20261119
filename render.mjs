// render.mjs: draw news.html into a PNG with headless Chromium over CDP.
//
// This is the provenance script for the entry image: it screenshots the
// front page in news.html at exactly 1024x1024. The submitted entry.png is
// the entrant-polished version of that render, so this script never writes
// entry.png itself.
//
//   node render.mjs [output.png]     (default: out/render.png)
//
// Chromium is found through CHROME_BIN, or at the install this machine
// ships (/opt/meta-chromium/chrome). No network is used: the page is opened
// from disk, and it loads no outside asset. The browser speaks to this
// script over its DevTools socket only.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const page = join(here, 'news.html')
const outFile = resolve(process.argv[2] ?? join(here, 'out', 'render.png'))

const chrome = process.env['CHROME_BIN'] ?? '/opt/meta-chromium/chrome'
if (!existsSync(chrome)) {
  console.error(`render: no Chromium at ${chrome} (set CHROME_BIN)`)
  process.exit(1)
}

// This Chromium build refuses to start without its WebGL domain policy,
// so pass the policy file and its SHA-256 when the file is present.
const policyFile = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt'
const policyArgs = existsSync(policyFile)
  ? [
      `--hatch-webgl-allowed-domains-file=${policyFile}`,
      `--hatch-webgl-allowed-domains-sha256=${createHash('sha256').update(readFileSync(policyFile)).digest('hex')}`,
    ]
  : []

// A small DevTools client: one socket, one id counter, one waiter per call,
// and one-shot listeners for the events the script waits on.
function connect(wsUrl) {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(wsUrl)
    const waiting = new Map()
    const listeners = new Map()
    let nextId = 1
    socket.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(String(data))
      if (msg.id !== undefined && waiting.has(msg.id)) {
        const { fulfil, fail } = waiting.get(msg.id)
        waiting.delete(msg.id)
        if (msg.error) fail(new Error(msg.error.message))
        else fulfil(msg.result)
      } else if (msg.method && listeners.has(msg.method)) {
        for (const fn of [...listeners.get(msg.method)]) fn(msg)
      }
    })
    socket.addEventListener('error', rejectSocket)
    socket.addEventListener('open', () => resolveSocket({
      call(method, params = {}, sessionId) {
        const id = nextId++
        return new Promise((fulfil, fail) => {
          waiting.set(id, { fulfil, fail })
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
        })
      },
      once(method, sessionId) {
        return new Promise((fulfil) => {
          const handler = (msg) => {
            if (sessionId && msg.sessionId !== sessionId) return
            listeners.set(method, (listeners.get(method) ?? []).filter((fn) => fn !== handler))
            fulfil(msg.params)
          }
          listeners.set(method, [...(listeners.get(method) ?? []), handler])
        })
      },
      close() { socket.close() },
    }))
  })
}

function timeout(ms, what) {
  return new Promise((_, fail) => setTimeout(
    () => fail(new Error(`render: timed out waiting for ${what}`)), ms))
}

const profile = mkdtempSync(join(tmpdir(), 'news-render-'))
const browser = spawn(chrome, [
  '--headless',
  ...policyArgs,
  '--no-sandbox',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--allow-file-access-from-files',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1024,1024',
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

let stderr = ''
const wsUrl = await new Promise((fulfil, fail) => {
  const timer = setTimeout(
    () => fail(new Error('render: DevTools socket never appeared')), 30000)
  browser.stderr.on('data', (chunk) => {
    stderr += chunk
    const found = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
    if (found) { clearTimeout(timer); fulfil(found[1]) }
  })
  browser.on('exit', (code) => fail(
    new Error(`render: Chromium exited early (${code}): ${stderr.slice(-500)}`)))
})

try {
  const devtools = await connect(wsUrl)
  const { targetId } = await devtools.call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await devtools.call('Target.attachToTarget', { targetId, flatten: true })
  await devtools.call('Page.enable', {}, sessionId)
  await devtools.call('Emulation.setDeviceMetricsOverride',
    { width: 1024, height: 1024, deviceScaleFactor: 1, mobile: false }, sessionId)
  const loaded = devtools.once('Page.loadEventFired', sessionId)
  await devtools.call('Page.navigate', { url: `file://${page}` }, sessionId)
  await Promise.race([loaded, timeout(30000, 'page load')])
  const { data } = await devtools.call('Page.captureScreenshot', { format: 'png' }, sessionId)
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, Buffer.from(data, 'base64'))
  devtools.close()
  console.log(`render: wrote ${outFile}`)
} finally {
  browser.kill()
}
