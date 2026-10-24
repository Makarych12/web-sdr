import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [], timers = new Set();
let sockets = 0;
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__audit = { pause: 0, suspend: 0, close: 0 };
  for (const [prototype, name, key] of [[HTMLMediaElement.prototype, 'pause', 'pause'], [AudioContext.prototype, 'suspend', 'suspend'], [WebSocket.prototype, 'close', 'close']]) {
    const original = prototype[name];
    prototype[name] = function(...args) { window.__audit[key]++; return original.apply(this, args); };
  }
});
await page.route('**/api/**', route => route.fulfill({ json: [] }));
await page.route('**/api/receivers', route => route.fulfill({ json: [{ id: 'diagnostic-test', name: 'Diagnostic fixture' }] }));
await page.routeWebSocket('**/ws', ws => {
  sockets++;
  ws.onMessage(data => {
    if (typeof data !== 'string' || JSON.parse(data).type !== 'connect') return;
    ws.send(JSON.stringify({ type: 'audio', sampleRate: 12000 }));
    const pcm = Buffer.alloc(2401); pcm[0] = 1;
    for (let i = 0; i < 1200; i++) pcm.writeInt16BE(Math.round(Math.sin(i / 10) * 5000), 1 + 2 * i);
    const timer = setInterval(() => { ws.send(pcm); ws.send(Buffer.from([2])); }, 100);
    timers.add(timer);
    ws.onClose(() => { clearInterval(timer); timers.delete(timer); });
  });
});
try {
  await page.goto((process.env.TEST_APP_URL || 'http://127.0.0.1:5173') + '/#listen');
  await page.locator('.receiver .connect').click();
  await page.waitForFunction(() => document.querySelector('.receiver .connect')?.textContent.includes('Отключиться'));
  await page.waitForFunction(() => localStorage.getItem('ur4mtn.radio-diagnostics.v1')?.includes('"type":"pcm"'));
  const before = await page.evaluate(() => ({ ...window.__audit }));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('freeze'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  });
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => window.__audit), before, 'hide/freeze/pagehide must not pause audio, suspend context or close WSS');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('resume'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(sockets, 1);
  // Exercise real native observer with a controlled CloseEvent (no transport recovery changes).
  await page.evaluate(async () => {
    const { observeRadioSocket } = await import('/src/radioDiagnostics.ts');
    const fake = Object.assign(new EventTarget(), { url: 'wss://fixture.invalid/ws/kiwi/test/SND', readyState: 3 });
    observeRadioSocket(fake);
    fake.dispatchEvent(new CloseEvent('close', { code: 1006, reason: 'diagnostic fixture', wasClean: false }));
  });
  await page.reload();
  await page.getByText('Диагностика приёма', { exact: true }).click();
  const journal = page.getByLabel('Диагностический журнал приёма');
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Диагностический журнал приёма"]')?.value.includes('diagnostic fixture'));
  const text = await journal.inputValue();
  for (const type of ['freeze', 'pagehide', 'resume', 'wss_close']) assert.ok(text.includes('"type":"' + type + '"'), type);
  const rows = text.split('\n').map(JSON.parse);
  assert.ok(rows.find(row => row.type === 'freeze' && row.lastPcm && row.wssState === 1 && row.context === 'running'));
  assert.ok(rows.find(row => row.type === 'wss_close' && row.code === 1006 && row.reason === 'diagnostic fixture'));
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Копировать журнал', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Скопировано' }).waitFor();
  assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('diagnostic fixture'));
  assert.deepEqual(errors, []);
  console.log('PASS: hide/freeze/pagehide do not stop PCM/audio/WSS; lifecycle + native close journal survives reload; copy works (desktop simulation only).');
} finally {
  for (const timer of timers) clearInterval(timer);
  await browser.close();
}
