import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  hasTouch: true,
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage(),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((simulateUnavailable) => {
  window.__simulateUnavailable = simulateUnavailable;
  const Socket = window.WebSocket;
  window.__sockets = [];
  window.__commands = [];
  window.WebSocket = class extends Socket {
    constructor(...a) {
      super(...a);
      window.__sockets.push(this);
    }
    send(value) {
      if (window.__simulateUnavailable && JSON.parse(value).type === "connect") {
        window.__simulateUnavailable = false;
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {data:JSON.stringify({type:"error",code:"badp",retryable:false,message:"Injected unavailable receiver for failover test"})})));
      }
      try {
        window.__commands.push(JSON.parse(value));
      } catch {}
      super.send(value);
    }
  };
  const Audio = window.AudioContext;
  window.AudioContext = class extends Audio {
    constructor(...a) {
      super(...a);
      window.__audio = this;
    }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...a) {
    if (this instanceof AudioWorkletNode) {
      window.__analyser = this.context.createAnalyser();
      connect.call(this, window.__analyser);
    }
    if (this instanceof GainNode && (a[0] === this.context.destination || a[0] instanceof MediaStreamAudioDestinationNode)) {
      window.__output = this.context.createAnalyser();
      window.__gain = this;
      connect.call(this, window.__output);
    }
    return connect.apply(this, a);
  };
}, process.env.TEST_FAILOVER === "1");
async function packets() {
  return page.evaluate(() => {
    const m = document
      .querySelector("footer")
      ?.textContent.match(/(\d+) PCM · (\d+) WF/);
    return m ? [+m[1], +m[2]] : [0, 0];
  });
}
async function healthy(label) {
  const before = await packets();
  await page.waitForFunction(
    ([audio, wf]) => {
      const m = document
        .querySelector("footer")
        ?.textContent.match(/(\d+) PCM · (\d+) WF/);
      const a = window.__analyser;
      if (
        !a ||
        !m ||
        +m[1] <= audio + 5 ||
        +m[2] <= wf + 2 ||
        !document
          .querySelector(".header-right")
          ?.textContent.includes("В эфире")
      )
        return false;
      const s = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(s);
      return s.some((v) => Math.abs(v) > 0.000001);
    },
    before,
    { timeout: 150000 },
  );
  checks.push(label);
  console.log("PASS", label);
}
try {
  await page.goto("https://web-sdr.vercel.app");
  await page.waitForFunction(() => document.querySelector("#receiver")?.value);
  await page.locator(".hero-cta").click();
  await healthy("baseline audio and waterfall");
  await page.evaluate(() => {
    window.__closes = [];
    for (const s of window.__sockets) s.addEventListener("close", (e) => window.__closes.push({code:e.code,reason:e.reason,clean:e.wasClean,at:Date.now()}));
  });
  const started = Date.now();
  const samples = [];
  while (Date.now() - started < 140000) {
    await page.waitForTimeout(15000);
    const sample = await page.evaluate(() => ({at:Date.now(),receiver:document.querySelector("#receiver")?.value,status:document.querySelector(".header-right")?.textContent,closes:window.__closes,sockets:window.__sockets.length,commands:window.__commands.filter(v=>v.type==="connect")}));
    sample.packets = await packets(); samples.push(sample); console.log(JSON.stringify(sample));
  }
  writeFileSync("artifacts/baseline-browser.json",JSON.stringify({samples,errors},null,2));
  await page.getByRole("button", {name:"Отключиться"}).click();
} finally { await browser.close(); }
