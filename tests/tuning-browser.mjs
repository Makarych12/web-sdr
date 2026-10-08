import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__commands = [];
  window.__rssi = [];
  window.__resets = 0;
  window.__sockets = [];
  const Native = WebSocket;
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      window.__sockets.push(this);
      this.addEventListener("message", (e) => {
        if (e.data instanceof ArrayBuffer) {
          const b = new Uint8Array(e.data);
          if (b.length >= 10 && b[0] === 83 && b[1] === 78 && b[2] === 68)
            window.__rssi.push(
              new DataView(e.data).getUint16(8, false) / 10 - 127,
            );
        } else if (typeof e.data === "string") {
          try {
            const v = JSON.parse(e.data);
            if (v.type === "signal") window.__rssi.push(v.rssi);
          } catch {}
        }
      });
    }
    send(v) {
      window.__commands.push(v);
      super.send(v);
    }
  };
  const fill = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (...a) {
    if (this.canvas.matches(".fall canvas")) window.__resets++;
    return fill.apply(this, a);
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...a) {
    if (this instanceof GainNode && (a[0] === this.context.destination || a[0] instanceof MediaStreamAudioDestinationNode)) {
      window.__output = this.context.createAnalyser();
      connect.call(this, window.__output);
    }
    return connect.apply(this, a);
  };
});
async function healthy() {
  await page.waitForFunction(
    () => {
      const c = document.querySelector(".fall canvas"),
        a = window.__output;
      if (!a || +c.dataset.rows < 20 || document.querySelector(".fall .empty"))
        return false;
      const pcm = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(pcm);
      return pcm.some((v) => Math.abs(v) > 1e-6);
    },
    {},
    { timeout: 45000 },
  );
}
async function state() {
  return page.evaluate(() => ({
    frequency: +document.querySelector("#frequency").value,
    zoom: +document.querySelector(".visual").dataset.zoom,
    span: +document.querySelector(".visual").dataset.span,
    start: +document.querySelector(".visual").dataset.start,
    rows: +document.querySelector(".fall canvas").dataset.rows,
    resets: window.__resets,
    sockets: window.__sockets.length,
    waiting: !!document.querySelector(".fall .empty"),
  }));
}
try {
  await page.goto(process.env.TEST_TUNING_URL || "http://127.0.0.1:5173");
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await page
    .locator(".band-selector button")
    .filter({ hasText: /^20m/ })
    .click();
  await page.locator(".connect").click();
  await healthy();
  const initial = await state();
  assert.equal(initial.frequency, 14200);
  assert.equal(initial.zoom, 6);
  await page.getByLabel("Шаг настройки", { exact: true }).selectOption("0.001");
  const dial = page.getByRole("slider", {
    name: "VFO — точная подстройка",
    exact: true,
  });
  await dial.focus();
  await dial.evaluate((el) => {
    for (let i = 0; i < 20; i++)
      el.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await page.waitForFunction(
    () => +document.querySelector("#frequency").value === 14200.02,
  );
  const after = await state();
  assert.equal(after.resets, initial.resets);
  assert.equal(after.start, initial.start);
  assert.equal(after.waiting, false);
  assert.equal(after.sockets, initial.sockets);
  await page.waitForFunction(() =>
    window.__commands.some((c) => c.includes("freq=14200.020")),
  );
  checks.push({
    test: "20 rapid VFO ticks: exact 1 Hz steps, real Kiwi command, no reset or waiting",
    initial,
    after,
  });
  await dial.press("PageDown");
  await page.waitForFunction(
    () => +document.querySelector("#frequency").value === 14200.01,
  );
  await page
    .getByRole("button", {
      name: "Точная подстройка: частота плюс шаг",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () => +document.querySelector("#frequency").value === 14200.011,
  );
  assert.equal((await state()).resets, initial.resets);
  checks.push({
    test: "keyboard and fine buttons preserve history",
    state: await state(),
  });
  // The wheel over an unfocused panorama scrolls the page, not the frequency range.
  await page.locator("#frequency").focus();
  await page.locator(".fall canvas").evaluate((el) =>
    el.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.equal((await state()).zoom, 6);
  checks.push({ test: "page scroll does not accidentally zoom" });
  for (const zoom of [0, 6, 11]) {
    await page
      .getByLabel("Масштаб waterfall", { exact: true })
      .fill(String(zoom));
    await healthy();
    const s = await state();
    assert.equal(s.zoom, zoom);
    assert.ok(Math.abs(s.span - 30000 / 2 ** zoom) < 0.0001);
    if (zoom > 0)
      assert.ok(Math.abs(s.start + s.span / 2 - s.frequency) < 0.01);
    const pixels = await page.locator(".fall canvas").evaluate((c) => {
      const b = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let white = 0;
      for (let i = 0; i < b.length; i += 4)
        if (b[i] > 248 && b[i + 1] > 248 && b[i + 2] > 248) white++;
      return white;
    });
    assert.equal(pixels, 0);
    await page
      .locator(".visual")
      .screenshot({ path: `artifacts/14200-zoom-${zoom}.png` });
    checks.push({
      test: "real 14200 kHz waterfall zoom",
      ...s,
      whitePixels: pixels,
    });
  }
  await page
    .getByRole("button", {
      name: "Сбросить масштаб: обзор диапазона",
      exact: true,
    })
    .click();
  await healthy();
  assert.equal((await state()).zoom, 6);
  const meter = await page.evaluate(() => ({
    raw: window.__rssi.slice(-100),
    display: document.querySelector(".smeter-top strong").textContent,
  }));
  assert.ok(meter.raw.length > 20);
  assert.ok(meter.raw.every(Number.isFinite));
  checks.push({ test: "live RSSI updates", ...meter });
  const displayedLevels = await page.evaluate(async () => {
    const levels = [];
    for (let i = 0; i < 30; i++) {
      levels.push(document.querySelector(".smeter-top small").textContent);
      await new Promise((r) => setTimeout(r, 100));
    }
    return levels;
  });
  assert.ok(new Set(displayedLevels).size > 1);
  checks.push({
    test: "S-meter display follows changing live RSSI",
    displayedLevels,
  });
  await page.getByLabel("Масштаб waterfall", { exact: true }).fill("11");
  await healthy();
  for (const [band, frequency] of [
    [40, 7100],
    [20, 14200],
  ]) {
    await page
      .locator(".band-selector button")
      .filter({ hasText: new RegExp(`^${band}m`) })
      .click();
    await healthy();
    const s = await state();
    assert.equal(s.zoom, 6);
    assert.equal(s.frequency, frequency);
    assert.ok(Math.abs(s.start + s.span / 2 - frequency) < 0.01);
    checks.push({ test: "band switch restores wide overview", band, ...s });
  }
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 1800 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    checks.push({ test: "no horizontal overflow", width });
  }
  await page.locator(".connect").click();
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/tuning-browser-report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log("PASS", checks);
} finally {
  await browser.close();
}
