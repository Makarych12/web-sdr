import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } }),
  stages = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const Native = WebSocket;
  window.__bins = null;
  window.WebSocket = class extends Native {
    constructor(...a) {
      super(...a);
      this.addEventListener("message", (e) => {
        if (e.data instanceof ArrayBuffer) {
          const b = new Uint8Array(e.data);
          if (b.length === 1040 && b[0] === 87 && b[1] === 47 && b[2] === 70)
            window.__bins = Array.from(b.subarray(16));
          if (b.length === 1025 && b[0] === 2)
            window.__bins = Array.from(b.subarray(1));
        }
      });
    }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...a) {
    if (this instanceof GainNode && (a[0] === this.context.destination || a[0] instanceof MediaStreamAudioDestinationNode)) {
      window.__out = this.context.createAnalyser();
      connect.call(this, window.__out);
    }
    return connect.apply(this, a);
  };
});
async function healthy(frequency, rows = 40) {
  await page.waitForFunction(
    ({ frequency, rows }) => {
      const v = document.querySelector(".visual"),
        c = document.querySelector(".fall canvas"),
        a = window.__out;
      if (
        !a ||
        +c.dataset.rows < rows ||
        Math.abs(+v.dataset.start + +v.dataset.span / 2 - frequency) > 0.01
      )
        return false;
      const pcm = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(pcm);
      return pcm.some((v) => Math.abs(v) > 1e-6);
    },
    { frequency, rows },
    { timeout: 90000 },
  );
}
async function sample(label) {
  const s = await page.evaluate(() => {
    const c = document.querySelector(".fall canvas"),
      b = c.getContext("2d").getImageData(0, 0, c.width, 1).data,
      l = [];
    for (let i = 0; i < b.length; i += 4)
      l.push(0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]);
    l.sort((a, b) => a - b);
    const bins = window.__bins.slice().sort((a, b) => a - b);
    return {
      noiseDb: +c.dataset.noiseDb,
      medianLuminance: l[Math.floor(l.length * 0.5)],
      brightFraction: l.filter((v) => v > 130).length / l.length,
      rawMedian: bins[512],
      rows: +c.dataset.rows,
    };
  });
  assert.ok(
    s.medianLuminance < 65,
    `${label}: bright noise wash ${JSON.stringify(s)}`,
  );
  stages.push({ label, ...s });
  console.log("PASS", label, s);
}
try {
  await page.goto(process.env.TEST_CONTRAST_URL || "http://127.0.0.1:5173");
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await page.locator(".connect").click();
  for (const [band, frequency] of [
    [160, 1840],
    [80, 3750],
    [40, 7100],
    [30, 10120],
    [20, 14200],
    [17, 18100],
    [15, 21200],
    [12, 24920],
    [10, 28400],
  ]) {
    await page
      .locator(".band-selector button")
      .filter({ hasText: new RegExp(`^${band}m`) })
      .click();
    await healthy(frequency);
    await sample(`${band}m`);
  }
  for (const [band, frequency] of [
    [40, 7100],
    [20, 14200],
  ]) {
    await page
      .locator(".band-selector button")
      .filter({ hasText: new RegExp(`^${band}m`) })
      .click();
    await healthy(frequency, 480);
    await sample(`${band}m full history`);
    await page
      .locator(".visual")
      .screenshot({ path: `artifacts/contrast-${band}m.png` });
  }
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 1800 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await sample(`mobile ${width}`);
    await page
      .locator(".visual")
      .screenshot({ path: `artifacts/contrast-${width}.png` });
  }
  const medians = stages.slice(0, 9).map((s) => s.medianLuminance);
  assert.ok(Math.max(...medians) - Math.min(...medians) < 20);
  await page.locator(".connect").click();
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/waterfall-contrast-report.json",
    JSON.stringify({ stages, errors }, null, 2),
  );
  console.log(
    "PASS consistent dark background across all bands, real PCM, desktop/mobile",
  );
} finally {
  await browser.close();
}
