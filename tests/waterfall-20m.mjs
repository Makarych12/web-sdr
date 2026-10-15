import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.TEST_APP_URL || "http://localhost:8787";
const seconds = Number(process.env.TEST_SECONDS || 600);
const width = Number(process.env.TEST_WIDTH || 1440),
  height = Number(process.env.TEST_HEIGHT || 1000),
  dpr = Number(process.env.TEST_DPR || 2);
const dir = process.env.TEST_ARTIFACT_DIR || "artifacts/waterfall-20m";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: dpr,
});
const report = {
  url: base,
  started: new Date().toISOString(),
  seconds,
  transitions: [],
  samples: [],
  errors: [],
};
page.on("pageerror", (e) => report.errors.push(e.message));
await page.addInitScript(() => {
  const W = WebSocket;
  window.__wf = {
    packets: 0,
    sockets: [],
    closes: [],
    audioPackets: 0,
    lastAudioAt: 0,
  };
  window.WebSocket = class extends W {
    constructor(...a) {
      super(...a);
      window.__wf.sockets.push(this);
      this.addEventListener("close", (e) =>
        window.__wf.closes.push({
          code: e.code,
          at: Date.now(),
          url: this.url,
        }),
      );
      this.addEventListener("message", (e) => {
        if (e.data instanceof ArrayBuffer) {
          const b = new Uint8Array(e.data);
          if (b.length >= 10 && b[0] === 83 && b[1] === 78 && b[2] === 68) {
            window.__wf.audioPackets++;
            window.__wf.lastAudioAt = Date.now();
          }
          if (b.length === 1040 && b[0] === 87 && b[1] === 47) {
            window.__wf.packets++;
            window.__wf.bins = Array.from(b.subarray(16));
          }
        }
      });
    }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...a) {
    if (this instanceof GainNode && a[0] === this.context.destination) {
      window.__audioAnalyser = this.context.createAnalyser();
      connect.call(this, window.__audioAnalyser);
    }
    return connect.apply(this, a);
  };
});
function save() {
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
}
async function sample(label) {
  const value = await page.evaluate(() => {
    const c = document.querySelector(".fall canvas"),
      ctx = c.getContext("2d"),
      data = ctx.getImageData(0, 0, c.width, 2).data,
      l = [];
    let gray = 0,
      alpha = 255;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      l.push(lum);
      alpha = Math.min(alpha, data[i + 3]);
      if (lum > 80 && Math.max(r, g, b) - Math.min(r, g, b) < 20) gray++;
    }
    l.sort((a, b) => a - b);
    const a = window.__audioAnalyser,
      pcm = new Float32Array(a?.fftSize || 1);
    a?.getFloatTimeDomainData(pcm);
    const styles = getComputedStyle(c),
      rect = c.getBoundingClientRect();
    return {
      at: Date.now(),
      frequency: document.querySelector("#frequency").value,
      noiseDb: +c.dataset.noiseDb,
      blackDb: +c.dataset.blackDb,
      medianLuminance: l[Math.floor(l.length / 2)],
      brightFraction: l.filter((v) => v > 130).length / l.length,
      grayFraction: gray / l.length,
      minAlpha: alpha,
      contextAlpha: ctx.getContextAttributes().alpha,
      smoothing: ctx.imageSmoothingEnabled,
      imageRendering: styles.imageRendering,
      opacity: styles.opacity,
      filter: styles.filter,
      blend: styles.mixBlendMode,
      canvas: {
        width: c.width,
        height: c.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        containerHeight: c.parentElement.clientHeight,
        dpr: devicePixelRatio,
      },
      closes: window.__wf.closes.length,
      rows: +c.dataset.rows,
      packets: window.__wf.packets,
      status: document.querySelector(".header-right").textContent,
      audioPackets: window.__wf.audioPackets,
      audioPacketAgeMs: Date.now() - window.__wf.lastAudioAt,
      audioState: a?.context.state,
      playbackDebug: document.querySelector("footer").textContent,
      audioRms: Math.sqrt(pcm.reduce((n, v) => n + v * v, 0) / pcm.length),
      sockets: window.__wf.sockets
        .filter((s) => s.readyState === 1 && !s.url.includes("?token="))
        .map((s) => s.url),
    };
  });
  assert.ok(
    value.medianLuminance < 65,
    `${label}: bright floor ${value.medianLuminance}`,
  );
  assert.equal(value.grayFraction, 0);
  assert.equal(value.minAlpha, 255);
  assert.equal(value.contextAlpha, false);
  assert.equal(value.smoothing, false);
  assert.equal(value.imageRendering, "pixelated");
  assert.equal(value.canvas.cssHeight, value.canvas.containerHeight);
  assert.equal(value.opacity, "1");
  assert.equal(value.filter, "none");
  assert.equal(value.blend, "normal");
  assert.ok(value.audioPackets > 0);
  assert.ok(value.audioPacketAgeMs < 5000);
  assert.ok(value.status.includes("В эфире"));
  assert.equal(value.closes, 0);
  return { label, ...value };
}
try {
  await page.goto(base + "/?debug#listen");
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 0,
  );
  await page.locator(".receiver .connect").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".header-right").textContent.includes("В эфире"),
    null,
    { timeout: 90000 },
  );
  for (const [band, frequency] of [
    [40, 7100],
    [20, 14200],
    [15, 21200],
    [20, 14200],
  ]) {
    const before = await page.evaluate(() => window.__wf.packets);
    await page
      .locator(".band-selector button")
      .filter({ hasText: new RegExp(`^${band}m`) })
      .click();
    await page.waitForFunction(
      ({ frequency, before }) => {
        const v = document.querySelector(".visual");
        return (
          window.__wf.packets > before + 3 &&
          Math.abs(+v.dataset.start + +v.dataset.span / 2 - frequency) < 0.01 &&
          !document
            .querySelector(".view-readout")
            .textContent.includes("Ожидаем")
        );
      },
      { frequency, before },
      { timeout: 30000 },
    );
    const value = await sample(
      `${band}m transition ${report.transitions.length + 1}`,
    );
    report.transitions.push(value);
    save();
    console.log("PASS", value.label, value.medianLuminance, value.noiseDb);
    await page.locator(".fall").screenshot({
      path: `${dir}/transition-${report.transitions.length}-${band}m.png`,
    });
  }
  report.holdStarted = new Date().toISOString();
  for (let elapsed = 0; elapsed <= seconds; elapsed += 10) {
    const value = await sample(`20m ${elapsed}s`);
    if (report.samples.length) {
      assert.ok(
        value.audioPackets > report.samples.at(-1).audioPackets,
        "SND packets must keep arriving",
      );
      assert.ok(
        value.packets > report.samples.at(-1).packets,
        "waterfall packets must keep arriving",
      );
    }
    report.samples.push(value);
    save();
    console.log(
      "PASS",
      value.label,
      JSON.stringify({
        floor: value.medianLuminance,
        noiseDb: value.noiseDb,
        packets: value.packets,
      }),
    );
    if (elapsed < seconds)
      await page.waitForTimeout(Math.min(10, seconds - elapsed) * 1000);
  }
  await page.locator(".fall").screenshot({ path: `${dir}/20m-final.png` });
  assert.deepEqual(report.errors, []);
} finally {
  report.finished = new Date().toISOString();
  save();
  await browser.close();
}
