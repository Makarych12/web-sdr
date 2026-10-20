import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

// Real upstream data, via the same local API used by production. Only the
// explicit error-recovery step below simulates an unavailable catalogue.
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
const network = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.url().includes('/api/repeaters?')) network.push({ url: response.url(), status: response.status() });
});
const endpoint = response => response.url().includes('/api/repeaters?');
async function reload(name) {
  const reply = page.waitForResponse(endpoint);
  await page.getByRole('button', { name, exact: true }).click();
  const response = await reply;
  assert.equal(response.status(), 200);
  return response.json();
}
try {
  await page.goto(process.env.TEST_APP_URL || 'http://localhost:5173');
  assert.equal(network.length, 0, 'catalogue is lazy');
  await page.getByRole('button', { name: '◎ Карта репитеров', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(network.length, 0, 'opening map does not claim user location');
  const reply = page.waitForResponse(endpoint);
  await page.getByLabel('Выбрать регион', { exact: true }).selectOption('4');
  const response = await reply;
  assert.equal(response.status(), 200);
  const data = await response.json();
  assert.equal(data.source, 'HearHam');
  assert.ok(data.count > 0);
  for (const row of data.rows) {
    assert.ok(Number.isFinite(row.lat) && Number.isFinite(row.lon));
    assert.ok(row.lat > 48 && row.lat < 51 && row.lon > -125 && row.lon < -121);
    assert.ok(row.distanceKm >= 0 && row.distanceKm <= 100);
  }
  await page.locator(`[aria-label="Количество репитеров"][data-markers="${data.rows.length}"]`).waitFor();
  assert.equal(await page.locator('.radio-map-list button').count(), data.rows.length);
  await page.locator('.radio-map-list button').first().click();
  const popup = page.locator('.leaflet-popup-content');
  await popup.waitFor();
  const record = data.rows[0];
  let body = await popup.innerText();
  for (const value of [record.callsign, record.frequency, record.shift, record.tones,
    record.lat.toFixed(5), record.lon.toFixed(5)]) if (value) assert.ok(body.includes(value), value);
  assert.equal(await popup.locator('a').getAttribute('href'), record.source);
  await page.locator('.leaflet-popup-close-button').click();
  // List selection centers the real marker. Click its geographic position on
  // the Canvas, not the list, to prove that an interactive marker exists.
  const bounds = await page.locator('.radio-map-canvas').boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await popup.waitFor();
  assert.ok((await popup.innerText()).includes('Координаты каталога:'));
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/radio-map-vancouver.png' });
  const refreshed = await reload('Обновить репитеры');
  assert.equal(refreshed.count, data.count);
  // Simulated failure is clearly distinct from the real successful responses.
  await page.route('**/api/repeaters?*', route => route.fulfill({ status: 503,
    contentType: 'application/json', json: { error: 'Тест недоступности каталога. Повторите загрузку.' } }));
  await page.getByRole('button', { name: 'Обновить репитеры', exact: true }).click();
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).waitFor();
  assert.ok((await page.locator('.radio-map-message[role="status"]').innerText()).includes('Тест недоступности'));
  await page.unroute('**/api/repeaters?*');
  const recovered = await reload('Повторить загрузку');
  assert.equal(recovered.count, data.count);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(`[data-markers="${data.rows.length}"]`).waitFor();
  const mobileMap = await page.locator('.radio-map-canvas').boundingBox();
  assert.ok(mobileMap.height >= 160 && mobileMap.width > 200);
  assert.ok(await page.getByRole('button', { name: 'Закрыть карту', exact: true }).isVisible());
  await page.screenshot({ path: 'artifacts/radio-map-mobile.png' });
  await page.getByRole('button', { name: 'Закрыть карту', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(errors, []);
  const report = { browser: 'Chromium', source: data.source, region: 'Vancouver, Canada',
    radiusKm: 100, count: data.count, displayedMarkers: data.rows.length,
    example: record, canvasMarkerClick: true, popupVerified: true,
    refresh: true, simulatedErrorAndRealRecovery: true, mobileLayout: true, close: true,
    network, errors };
  writeFileSync('artifacts/radio-map-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
