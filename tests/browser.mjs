import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const NativeSocket = window.WebSocket;
  window.__sockets = [];
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      window.__sockets.push(this);
    }
  };
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(...args) {
      super(...args);
      window.__audio = this;
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (...a) {
        if (this instanceof AudioWorkletNode) {
          window.__analyser = this.context.createAnalyser();
          connect.call(this, window.__analyser);
        }
        if (this instanceof GainNode && a[0] === this.context.destination) {
          window.__outputAnalyser = this.context.createAnalyser();
          connect.call(this, window.__outputAnalyser);
          window.__gain = this;
        }
        return connect.apply(this, a);
      };
    }
  };
});
try {
  await page.goto("http://localhost:8787");
  await page.getByRole("button", { name: "Слушать эфир" }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("footer")
        ?.textContent?.match(/[1-9]\d* PCM · [1-9]\d* WF/),
    { timeout: 30000 },
  );
  await page.waitForFunction(
    () => {
      const a = window.__analyser;
      if (!a) return false;
      const samples = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(samples);
      return samples.some((v) => Math.abs(v) > 0.00001);
    },
    { timeout: 20000 },
  );
  assert.equal(await page.evaluate(() => window.__audio.state), "running");
  await page.getByRole("textbox", { name: "Частота кГц" }).fill("7074");
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await page.getByRole("button", { name: "USB", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".axis")?.textContent?.includes("7.074"),
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector("footer")?.textContent?.match(/(\d+) WF/)?.[1],
      ) >= 80,
    null,
    { timeout: 30000 },
  );
  const before = await page.evaluate(() => window.__sockets.length);
  await page.evaluate(() => window.__sockets.at(-1).close());
  await page.waitForFunction(
    (n) =>
      window.__sockets.length > n &&
      document.querySelector(".header-right")?.textContent?.includes("В эфире"),
    before,
    { timeout: 30000 },
  );
  assert.equal(
    await page.getByRole("textbox", { name: "Частота кГц" }).inputValue(),
    "7074",
  );
  await page.waitForFunction(
    () => {
      const a = window.__analyser,
        s = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(s);
      return s.some((v) => Math.abs(v) > 0.00001);
    },
    null,
    { timeout: 20000 },
  );
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  for (const [name, width, height] of [
    ["phone", 390, 844],
    ["tablet", 820, 1180],
  ]) {
    await page.setViewportSize({ width, height });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Отключиться" }).click();
  const stopped = await page.evaluate(() => window.__sockets.length);
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(() => window.__sockets.length), stopped);
  assert.equal(errors.length, 0, errors.join("\n"));
  writeFileSync(
    "artifacts/browser-report.json",
    JSON.stringify(
      {
        audioContext: "running",
        nonzeroWorkletOutput: true,
        autoReconnect: true,
        frequency: 7074,
        mode: "USB",
        viewports: [1440, 390, 820],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: actual AudioWorklet output, tuning, waterfall, desktop/tablet/phone",
  );
} catch (e) {
  console.error(await page.evaluate(()=>({status:document.querySelector(".header-right")?.textContent,error:document.querySelector(".error")?.textContent})));
  console.error(errors);
  await page.screenshot({ path: "artifacts/failure.png", fullPage: true });
  throw e;
} finally {
  await browser.close();
}
