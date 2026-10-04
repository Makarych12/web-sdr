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
await page.addInitScript(() => {
  const Socket = window.WebSocket;
  window.__sockets = [];
  window.__commands = [];
  window.WebSocket = class extends Socket {
    constructor(...a) {
      super(...a);
      window.__sockets.push(this);
    }
    send(value) {
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
});
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
    { timeout: 45000 },
  );
  checks.push(label);
  console.log("PASS", label);
}
async function viewport() {
  return page.evaluate(() => {
    const e = document.querySelector(".visual");
    return {
      start: +e.dataset.start,
      span: +e.dataset.span,
      zoom: +e.dataset.zoom,
    };
  });
}
async function changedView(previous) {
  await page.waitForFunction(
    (p) => {
      const e = document.querySelector(".visual");
      return (
        Math.abs(+e.dataset.start - p.start) > 0.001 ||
        Math.abs(+e.dataset.span - p.span) > 0.001
      );
    },
    previous,
    { timeout: 15000 },
  );
}
async function touchDrag(canvas, from, to) {
  await canvas.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const b = await canvas.boundingBox();
  const session = await context.newCDPSession(page);
  const pt = (f) => ({ x: b.x + b.width * f, y: b.y + b.height * 0.5, id: 1 });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [pt(from)],
  });
  for (let i = 1; i <= 8; i++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [pt(from + ((to - from) * i) / 8)],
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
}
try {
  await page.goto(process.env.TEST_APP_URL || "http://localhost:8787");
  await page.waitForFunction(
    () => document.querySelectorAll("#receiver option").length > 20,
  );
  await page.getByRole("button", { name: /Все приёмники/ }).click();
  await page
    .getByRole("textbox", { name: "Поиск приёмников" })
    .fill("Montmorillon");
  assert.ok((await page.locator(".catalog-item").count()) > 0);
  await page.locator(".catalog-item").first().click();
  await page
    .getByRole("button", { name: "Избранный сервер", exact: true })
    .click();
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("#receiver")?.value === "france",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Избранный сервер", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  checks.push("catalog search and server favorites persist");
  await page.locator(".hero-cta").click();
  await healthy("initial real audio and waterfall");
  assert.match(
    await page
      .getByRole("meter", { name: "Уровень радиосигнала" })
      .getAttribute("aria-valuetext"),
    /dBm/,
  );
  await page.getByRole("textbox", { name: "Частота кГц" }).fill("7074");
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await page.getByRole("button", { name: "USB", exact: true }).click();
  await page.waitForFunction(
    () =>
      Math.abs(
        +document.querySelector(".visual").dataset.start +
          +document.querySelector(".visual").dataset.span / 2 -
          7074,
      ) < 0.01,
  );
  await healthy("frequency and USB");
  const steps = page.getByLabel("Шаг настройки", { exact: true });
  assert.deepEqual(await steps.locator("option").allTextContents(), [
    "1 Hz",
    "10 Hz",
    "100 Hz",
    "1000 Hz",
    "5000 Hz",
    "10000 Hz",
  ]);
  await steps.selectOption("0.001");
  await page
    .getByRole("button", { name: "Шаг частоты вверх", exact: true })
    .click();
  assert.equal(await page.locator("#frequency").inputValue(), "7074.001");
  await healthy("1 Hz tuning step");
  await page
    .getByRole("button", { name: "Шаг частоты вниз", exact: true })
    .click();
  assert.equal(await page.locator("#frequency").inputValue(), "7074");
  const dial = page.getByRole("slider", {
    name: "VFO — ручка настройки",
    exact: true,
  });
  await dial.focus();
  await dial.press("ArrowRight");
  assert.equal(await page.locator("#frequency").inputValue(), "7074.001");
  await dial.press("ArrowLeft");
  await dial.scrollIntoViewIfNeeded();
  const dialBox = await dial.boundingBox();
  await page.mouse.move(
    dialBox.x + dialBox.width * 0.88,
    dialBox.y + dialBox.height * 0.5,
  );
  await page.mouse.down();
  for (let a = 0; a <= Math.PI / 2; a += Math.PI / 16) {
    await page.mouse.move(
      dialBox.x + dialBox.width * (0.5 + 0.38 * Math.cos(a)),
      dialBox.y + dialBox.height * (0.5 + 0.38 * Math.sin(a)),
    );
  }
  await page.mouse.up();
  assert.ok(+(await page.locator("#frequency").inputValue()) > 7074);
  await healthy("real rotary VFO drag");
  await page.locator("#frequency").fill("7074");
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await steps.selectOption("1");
  for (const agc of ["fast", "off", "slow"]) {
    await page.getByLabel("AGC", { exact: true }).selectOption(agc);
    await page.waitForFunction(
      (value) => window.__commands.at(-1)?.agc === value,
      agc,
    );
    await healthy("AGC " + agc + " preserves stream");
  }
  for (const [band, freq] of [
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
    assert.equal(+(await page.locator("#frequency").inputValue()), freq);
    await healthy(`${band}m band tuning`);
  }
  await page.locator("#frequency").fill("7074");
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await page.getByRole("button", { name: "USB", exact: true }).click();
  await page.getByLabel("Полоса фильтра", { exact: true }).selectOption("1800");
  await page.waitForFunction(() => window.__commands.at(-1)?.highCut === 2100);
  await healthy("1800 Hz passband");
  await page.getByRole("button", { name: "Избранная частота" }).click();
  await page.locator("#volume").evaluate((e) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(e, "0.25");
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(
    () => Math.abs(window.__gain.gain.value - 0.25) < 0.001,
  );
  await healthy("volume changes without interrupting receiver");
  await page
    .getByRole("button", { name: "Выключить звук", exact: true })
    .click();
  await page.waitForFunction(() => {
    const a = window.__output,
      s = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(s);
    return s.every((v) => Math.abs(v) < 0.000001);
  });
  await page
    .getByRole("button", { name: "Включить звук", exact: true })
    .click();
  await page.waitForFunction(() => {
    const a = window.__output,
      s = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(s);
    return s.some((v) => Math.abs(v) > 0.000001);
  });
  await healthy("mute and unmute actual gain output");
  let before = await viewport();
  await page.getByRole("button", { name: "Увеличить масштаб" }).click();
  await changedView(before);
  let after = await viewport();
  assert.ok(Math.abs(after.span - before.span / 2) < 0.01);
  await healthy("zoom");
  const frequencyBefore = await page
    .getByRole("textbox", { name: "Частота кГц" })
    .inputValue();
  before = after;
  await page.getByRole("button", { name: "Панорама вправо" }).click();
  await changedView(before);
  assert.equal(
    await page.getByRole("textbox", { name: "Частота кГц" }).inputValue(),
    frequencyBefore,
  );
  await healthy("pan preserves audio frequency");
  await page.getByRole("button", { name: "К частоте", exact: true }).click();
  await healthy("recenter");
  await page.setViewportSize({ width: 390, height: 844 });
  const canvas = page.locator(".scope canvas");
  before = await viewport();
  await touchDrag(canvas, 0.45, 0.65);
  await page.waitForFunction(
    (expected) =>
      Math.abs(+document.querySelector("#frequency").value - expected) < 0.01,
    before.start + before.span * 0.65,
  );
  await healthy("real finger drag tunes spectrum");
  before = await viewport();
  await touchDrag(page.locator(".fall canvas"), 0.4, 0.55);
  await page.waitForFunction(
    (expected) =>
      Math.abs(+document.querySelector("#frequency").value - expected) < 0.01,
    before.start + before.span * 0.55,
  );
  await healthy("finger drag tunes waterfall");
  await touchDrag(page.locator(".frequency-scale"), 0.4, 0.6);
  await healthy("finger drag tunes frequency scale");

  before = await viewport();
  const tuned = await page
    .getByRole("textbox", { name: "Частота кГц" })
    .inputValue();
  await page
    .getByRole("button", { name: "Панорама", exact: false })
    .filter({ hasText: "↔" })
    .click();
  await touchDrag(page.locator(".fall canvas"), 0.6, 0.4);
  await changedView(before);
  assert.equal(
    await page.getByRole("textbox", { name: "Частота кГц" }).inputValue(),
    tuned,
  );
  await healthy("finger drag pans waterfall without retuning");
  const fall = page.locator(".fall canvas");
  await fall.scrollIntoViewIfNeeded();
  const box = await fall.boundingBox(),
    cdp = await context.newCDPSession(page);
  before = await viewport();
  const points = (d) => [
    { id: 1, x: box.x + box.width * (0.5 - d), y: box.y + box.height * 0.5 },
    { id: 2, x: box.x + box.width * (0.5 + d), y: box.y + box.height * 0.5 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(0.15),
  });
  for (let i = 1; i <= 8; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(0.15 + (0.15 * i) / 8),
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  await changedView(before);
  await page.waitForFunction(
    (z) => +document.querySelector(".visual").dataset.zoom === z,
    before.zoom + 1,
    { timeout: 15000 },
  );
  after = await viewport();
  assert.equal(after.zoom, before.zoom + 1);
  assert.equal(
    await page.getByRole("textbox", { name: "Частота кГц" }).inputValue(),
    tuned,
  );
  await healthy("two-finger pinch changes zoom");
  const expectedView = await viewport(),
    connections = await page.evaluate(() => window.__sockets.length);
  await page.evaluate(() => window.__sockets.at(-1).close());
  await page.waitForFunction((n) => window.__sockets.length > n, connections, {
    timeout: 15000,
  });
  await healthy("auto reconnect restores real audio and waterfall");
  assert.equal(
    await page.getByRole("textbox", { name: "Частота кГц" }).inputValue(),
    tuned,
  );
  after = await viewport();
  assert.ok(Math.abs(after.start - expectedView.start) < 0.01);
  assert.equal(after.zoom, expectedView.zoom);
  assert.equal(
    await page.getByLabel("Полоса фильтра", { exact: true }).inputValue(),
    "1800",
  );
  if (process.env.TEST_SECOND_RECEIVER) {
    await page
      .getByLabel("Приёмник", { exact: true })
      .selectOption(process.env.TEST_SECOND_RECEIVER);
    await healthy("switch to another public KiwiSDR");
    await page.getByLabel("Приёмник", { exact: true }).selectOption("france");
    await healthy("switch back to original KiwiSDR");
  }
  mkdirSync("artifacts", { recursive: true });
  for (const [name, width, height] of [
    ["phone", 390, 844],
    ["small-phone", 320, 740],
    ["tablet", 820, 1180],
    ["desktop", 1440, 1100],
  ]) {
    await page.setViewportSize({ width, height });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/sdr-${name}.png`,
      fullPage: true,
    });
  }
  checks.push("320/390/820/1440 layouts without overflow");
  await page.getByRole("button", { name: "Отключиться" }).click();
  const stopped = await page.evaluate(() => window.__sockets.length);
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(() => window.__sockets.length), stopped);
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector(".saved-frequencies")?.textContent.includes("7074"),
  );
  assert.equal(await page.locator("#volume").inputValue(), "0.25");
  await page
    .locator(".saved-frequencies button")
    .filter({ hasText: "7074 kHz" })
    .click();
  assert.equal(await page.locator("#frequency").inputValue(), "7074");
  assert.equal(await page.locator("#filter-width").inputValue(), "1800");
  await page.getByRole("button", { name: "Слушать эфир" }).click();
  await healthy("saved frequency restores mode/filter after reload");
  await page.getByRole("button", { name: "Отключиться" }).click();
  assert.equal(errors.length, 0, errors.join("\n"));
  writeFileSync(
    "artifacts/sdr-browser-report.json",
    JSON.stringify(
      { testedAt: new Date().toISOString(), checks, pageErrors: errors },
      null,
      2,
    ),
  );
  console.log(
    "PASS: SDR controls, storage, gestures, reconnect, actual audio and waterfall",
  );
} catch (e) {
  mkdirSync("artifacts", { recursive: true });
  console.error(
    await page.evaluate(() => ({
      status: document.querySelector(".header-right")?.textContent,
      frequency: document.querySelector("#frequency")?.value,
      view: document.querySelector(".visual")?.dataset,
      commands: window.__commands.slice(-5),
    })),
  );
  console.error(errors);
  await page.screenshot({ path: "artifacts/sdr-failure.png", fullPage: true });
  throw e;
} finally {
  await browser.close();
}
