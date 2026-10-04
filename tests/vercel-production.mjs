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
    if (this instanceof GainNode && a[0] === this.context.destination) {
      window.__output = this.context.createAnalyser();
      window.__gain = this;
      connect.call(this, window.__output);
    }
    return connect.apply(this, a);
  };
}, process.env.TEST_FAILOVER === "1");
async function chooseReceiver(id) {
  const rows = await (await page.request.get(new URL("/api/receivers", process.env.TEST_APP_URL || "https://web-sdr.vercel.app").href)).json();
  const receiver = rows.find((r) => r.id === id);
  assert.ok(receiver, `receiver ${id}`);
  await page.getByRole("button", {name:"Приёмник", exact:true}).click();
  await page.getByRole("textbox", {name:"Поиск приёмников"}).fill(receiver.name);
  await page.locator(".catalog-item").first().click();
}
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
  const url = process.env.TEST_APP_URL || "https://web-sdr.vercel.app";
  await page.goto(url);
  await page.waitForFunction(() => +document.querySelector(".receiver-choice")?.dataset.count > 20);
  await chooseReceiver("france");
  await page.locator(".hero-cta").click();
  await healthy("production KiwiSDR connection, nonzero AudioWorklet samples and waterfall");
  const activeReceiver = await page.locator("#receiver").inputValue();
  console.log("Active receiver:", activeReceiver);
  if (process.env.TEST_FAILOVER === "1") assert.notEqual(activeReceiver, "france");
  await page.getByRole("textbox", { name: "Частота кГц" }).fill("7074");
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await page.getByRole("button", { name: "USB", exact: true }).click();
  await page.getByLabel("Полоса фильтра", { exact: true }).selectOption("1800");
  await page.waitForFunction(() => window.__commands.at(-1)?.frequency === 7074 && window.__commands.at(-1)?.highCut === 2100);
  await healthy("production frequency change and USB filter");
  await page.waitForFunction(() => {
    const e = document.querySelector(".visual");
    return Math.abs(+e.dataset.start + +e.dataset.span / 2 - 7074) < 0.01;
  });
  const connections = await page.evaluate(() => window.__sockets.length);
  await page.evaluate(() => window.__sockets.at(-1).close());
  await page.waitForFunction((n) => window.__sockets.length > n, connections, { timeout: 150000 });
  await healthy("production automatic reconnect restores audio and waterfall");
  const restored = await page.evaluate(() => window.__commands.filter((v) => v.type === "connect").at(-1));
  assert.equal(restored.receiver, await page.locator("#receiver").inputValue());
  assert.equal(restored.frequency, 7074);
  assert.equal(restored.mode, "USB");
  assert.equal(restored.lowCut, 300);
  assert.equal(restored.highCut, 2100);
  assert.equal(await page.locator("#frequency").inputValue(), "7074");
  assert.equal(errors.length, 0, errors.join("\n"));
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/vercel-production.png", fullPage: true });
  writeFileSync(`artifacts/vercel-${process.env.TEST_FAILOVER ? "failover" : "production"}-report.json`, JSON.stringify({simulatedInitialFailure: process.env.TEST_FAILOVER === "1",url, testedAt:new Date().toISOString(), checks, restored, packets:await packets(), pageErrors:errors}, null, 2));
  const card = page.locator(".qsl-preview");
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .25);
  await page.waitForTimeout(350);
  assert.notEqual(await card.evaluate((el) => el.style.getPropertyValue("--ry")), "0deg");
  assert.equal(await card.evaluate((el) => getComputedStyle(el).borderTopWidth), "0px");
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({width, height:900});
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`);
    await page.screenshot({path:`artifacts/vercel-card-${width}.png`, fullPage:true});
  }
  await page.emulateMedia({reducedMotion:"reduce"});
  assert.equal(await card.evaluate((el) => getComputedStyle(el).transform), "none");
  console.log("PASS borderless QSL parallax, reduced motion and responsive layouts");
  await page.getByRole("button", { name: "Отключиться" }).click();
  console.log("PASS production requirements");
} finally {
  await browser.close();
}
