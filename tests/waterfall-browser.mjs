import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
const errors = [],
  stages = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__capture = null;
  window.__source = null;
  window.__sockets = [];
  window.__clears = 0;
  const Native = WebSocket;
  window.WebSocket = class extends Native {
    constructor(...a) {
      super(...a);
      window.__sockets.push(this);
      this.addEventListener("message", (e) => {
        if (typeof e.data === "string") {
          try {
            const v = JSON.parse(e.data);
            if (v.type === "view") window.__source = v;
          } catch {}
        } else if (e.data instanceof ArrayBuffer) {
          const b = new Uint8Array(e.data);
          if (b.length === 1025 && b[0] === 2 && window.__source)
            window.__capture = {
              bins: Array.from(b.subarray(1)),
              view: { ...window.__source },
            };
        }
      });
    }
  };
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...a) {
    if (this.canvas.matches(".fall canvas")) window.__clears++;
    return clear.apply(this, a);
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
await page.route("**/api/receivers", async (route) => {
  const response = await route.fetch();
  const rows = await response.json();
  for (const row of rows) delete row.directUrl;
  await route.fulfill({ response, json: rows });
});
const url = process.env.TEST_RENDERER_URL || "http://127.0.0.1:5173";
async function healthy(center) {
  await page.waitForFunction(
    (center) => {
      const visual = document.querySelector(".visual"),
        fall = document.querySelector(".fall canvas");
      if (
        +fall.dataset.rows < 12 ||
        Math.abs(+visual.dataset.start + +visual.dataset.span / 2 - center) >
          0.01
      )
        return false;
      const a = window.__output;
      if (!a) return false;
      const pcm = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(pcm);
      return pcm.some((v) => Math.abs(v) > 0.000001);
    },
    center,
    { timeout: 45000 },
  );
}
async function sample(label) {
  const report = await page.evaluate(async () => {
    let white = 0;
    for (let n = 0; n < 15; n++) {
      const c = document.querySelector(".fall canvas"),
        bytes = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < bytes.length; i += 4)
        if (bytes[i] > 248 && bytes[i + 1] > 248 && bytes[i + 2] > 248) white++;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const bins = window.__capture.bins;
    return {
      whitePixels: white,
      clearRectCalls: window.__clears,
      rows: +document.querySelector(".fall canvas").dataset.rows,
      peakByte: Math.max(...bins),
      meanByte: bins.reduce((a, b) => a + b, 0) / bins.length,
      oldPaletteUpperLimit: bins.filter((v) => v >= 243).length,
    };
  });
  assert.equal(report.whitePixels, 0);
  assert.equal(report.clearRectCalls, 0);
  stages.push({ label, ...report });
  console.log("PASS", label, report);
}
try {
  await page.goto(url);
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await page.locator("#frequency").fill("7100");
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await page.locator(".connect").click();
  await healthy(7100);
  // Fault injection on detached canvases, using bytes captured from the live Kiwi, never generated signals.
  const faults = await page.evaluate(async () => {
    const { SpectrumRenderer, waterfallColor } =
      await import("/src/spectrumRenderer.ts");
    const { viewFor } = await import("/src/spectrumView.ts");
    const captured = window.__capture,
      bins = new Uint8Array(captured.bins),
      view = captured.view;
    const sc = document.createElement("canvas"),
      wc = document.createElement("canvas");
    sc.width = wc.width = 1024;
    wc.height = 480;
    const r = new SpectrumRenderer(sc, wc, view),
      checks = [];
    const expect = (ok, label) => {
      if (!ok) throw Error(label);
      checks.push(label);
    };
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(resolve));
    expect(!r.append(bins.subarray(1), view), "wrong-length row rejected");
    expect(
      !r.append(bins, { ...view, span: NaN }),
      "nonfinite metadata rejected",
    );
    expect(
      !r.append(bins, { ...view, span: view.span * 2 }),
      "inconsistent positive span rejected",
    );
    expect(
      !r.append(bins, { ...view, start: view.start + view.span }),
      "stale band rejected",
    );
    expect(
      r.append(bins, { ...view, sequence: 100 }),
      "valid captured row accepted",
    );
    expect(
      !r.append(bins, { ...view, sequence: 100 }),
      "duplicate sequence rejected",
    );
    expect(
      !r.append(bins, { ...view, sequence: 99 }),
      "backward sequence rejected",
    );
    expect(
      r.append(bins, { ...view, sequence: 10000 }),
      "forward sequence gap accepted safely",
    );
    await frame();
    expect(+wc.dataset.rows === 4, "received rows scroll sequentially");
    for (let sequence = 10001; sequence < 10033; sequence++)
      r.append(bins, { ...view, sequence });
    await frame();
    expect(+wc.dataset.rows === 20, "burst queue bounded to eight newest rows");
    const frames = r.frames;
    await frame();
    await frame();
    expect(r.frames === frames, "no idle animation redraw");
    r.clear();
    expect(wc.dataset.rows === "0", "reset clears history immediately");
    expect(
      r.append(bins, { ...view, sequence: 0xffffffff }) &&
        r.append(bins, { ...view, sequence: 0 }),
      "uint32 sequence wraps safely",
    );
    await frame();
    wc.width = 390;
    expect(
      r.append(bins, { ...view, sequence: 1 }),
      "canvas resize accepts fresh row",
    );
    await frame();
    expect(+wc.dataset.rows === 2, "resize drops old-width history");
    for (let zoom = 0; zoom <= 14; zoom++) {
      const target = viewFor(14200, zoom, 30000);
      r.setView(target);
      expect(wc.dataset.rows === "0", "zoom " + zoom + " resets history");
      expect(
        r.append(bins, { ...target, sequence: zoom + 2 }),
        "zoom " + zoom + " handles captured bytes",
      );
      await frame();
    }
    r.setCalibration(0);
    expect(wc.dataset.rows === "0", "calibration change resets color history");
    wc.width = 0;
    expect(
      !r.append(bins, { ...view, sequence: 100000 }),
      "zero-width canvas skips data safely",
    );
    wc.width = 320;
    r.setView(view);
    expect(
      r.append(bins, { ...view, sequence: 100001 }),
      "canvas recovers after zero width",
    );
    await frame();
    expect(
      +wc.dataset.rows === 2,
      "recovered canvas contains fresh history only",
    );
    r.setCalibration(NaN);
    r.setCalibration(Infinity);
    expect(
      waterfallColor(255, -13)
        .slice(0, 3)
        .some((v) => v < 248),
      "maximum color cannot become white",
    );
    r.dispose();
    return checks;
  });
  stages.push({
    label: "renderer fault injection with captured real bytes",
    checks: faults,
  });
  for (const [band, frequency] of [
    [40, 7100],
    [20, 14200],
    [40, 7100],
    [10, 28400],
  ]) {
    await page
      .locator(".band-selector button")
      .filter({ hasText: new RegExp(`^${band}m`) })
      .click();
    await healthy(frequency);
    await sample(band + "m / band switch");
    mkdirSync("artifacts", { recursive: true });
    await page
      .locator(".visual")
      .screenshot({ path: `artifacts/stable-waterfall-${band}m.png` });
  }
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 1800 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await sample("mobile " + width);
    await page
      .locator(".visual")
      .screenshot({ path: `artifacts/stable-waterfall-${width}.png` });
  }
  const before = await page.evaluate(() => window.__sockets.length);
  await page.evaluate(() => window.__sockets.at(-1).close());
  await page.waitForFunction((n) => window.__sockets.length > n, before, {
    timeout: 20000,
  });
  await healthy(28400);
  await sample("reconnect starts clean real history");
  await page.locator(".connect").click();
  assert.equal(errors.length, 0, errors.join("\n"));
  writeFileSync(
    "artifacts/waterfall-stability-report.json",
    JSON.stringify(
      { testedAt: new Date().toISOString(), stages, pageErrors: errors },
      null,
      2,
    ),
  );
  console.log("PASS waterfall stability and captured-byte fault tests");
} finally {
  await browser.close();
}
