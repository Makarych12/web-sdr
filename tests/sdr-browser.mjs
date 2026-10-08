import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const testReceiver = process.env.TEST_RECEIVER || "france";
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
    if (this instanceof GainNode && (a[0] === this.context.destination || a[0] instanceof MediaStreamAudioDestinationNode)) {
      window.__output = this.context.createAnalyser();
      window.__gain = this;
      connect.call(this, window.__output);
    }
    return connect.apply(this, a);
  };
});
async function chooseReceiver(id) {
  const rows = await (
    await page.request.get(
      new URL(
        "/api/receivers",
        process.env.TEST_APP_URL || "http://localhost:8787",
      ).href,
    )
  ).json();
  const receiver = rows.find((r) => r.id === id);
  assert.ok(receiver, `receiver ${id}`);
  await page.getByRole("button", { name: "Приёмник", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Поиск приёмников" })
    .fill(receiver.name);
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
        +document.querySelector(".fall canvas")?.dataset.rows < 2 ||
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
async function touchRotate(dial) {
  await dial.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  const b = await dial.boundingBox(),
    session = await context.newCDPSession(page);
  const point = (angle) => ({
    id: 1,
    x: b.x + b.width * (0.5 + 0.35 * Math.cos(angle)),
    y: b.y + b.height * (0.5 + 0.35 * Math.sin(angle)),
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(0)],
  });
  for (let i = 1; i <= 8; i++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point((i * Math.PI) / 16)],
    });
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
}
try {
  if (process.env.TEST_GATEWAY) {
    // Use the actual catalog and live Kiwi data, explicitly via the local gateway.
    await page.route("**/api/receivers", async (route) => {
      const response = await route.fetch();
      const rows = await response.json();
      for (const row of rows) delete row.directUrl;
      await route.fulfill({ response, json: rows });
    });
  }
  await page.goto(process.env.TEST_APP_URL || "http://localhost:8787");
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await chooseReceiver(testReceiver);
  await page
    .getByRole("button", { name: "Избранный сервер", exact: true })
    .click();
  await page.reload();
  await page.waitForFunction(
    (id) => document.querySelector("#receiver")?.value === id,
    testReceiver,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Избранный сервер", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  checks.push("catalog search and server favorites persist");
  await page.waitForFunction(
    () => document.querySelector(".fall canvas")?.dataset.rows === "0",
  );
  assert.ok(
    await page.locator(".scope canvas").evaluate((c) => {
      const bytes = c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < bytes.length; i += 4)
        if (Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) > 80) return false;
      return true;
    }),
    "idle spectrum has only the grid, no artificial signals",
  );
  assert.ok(
    await page.locator(".fall canvas").evaluate((c) =>
      c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height)
        .data.every((v, i) => v === [3, 6, 11, 255][i % 4]),
    ),
    "idle waterfall contains no generated rows",
  );
  await page.locator(".hero-cta").click();
  await healthy("initial real audio and waterfall");
  // The under-waterfall controls must tune the same running audio/session.
  await page.evaluate(() => {
    window.__originalAudio = window.__audio;
    window.__originalAnalyser = window.__analyser;
    window.__originalSocket = window.__sockets.at(-1);
    window.__originalSpectrum = document.querySelector(".scope canvas");
    window.__originalWaterfall = document.querySelector(".fall canvas");
  });
  const fine = page.getByRole("region", {
    name: "Точная подстройка под waterfall",
  });
  for (const [name, delta] of [
    ["Точная подстройка: частота минус шаг", -1],
    ["Точная подстройка: частота плюс шаг", 1],
    ["Подстройка −10 шагов", -10],
    ["Подстройка −1 шагов", -1],
    ["Подстройка +1 шагов", 1],
    ["Подстройка +10 шагов", 10],
  ]) {
    const f = +(await page.locator("#frequency").inputValue());
    await fine.getByRole("button", { name, exact: true }).click();
    assert.equal(+(await page.locator("#frequency").inputValue()), f + delta);
    assert.equal(
      await fine.locator("output").innerText(),
      `${Math.round((f + delta) * 1000).toLocaleString("de-DE")} Hz`,
    );
  }
  const fineDial = fine.getByRole("slider", {
    name: "VFO — точная подстройка",
    exact: true,
  });
  for (const [key, delta] of [
    ["ArrowRight", 1],
    ["ArrowLeft", -1],
    ["PageUp", 10],
    ["PageDown", -10],
  ]) {
    const f = +(await page.locator("#frequency").inputValue());
    await fineDial.press(key);
    assert.equal(+(await page.locator("#frequency").inputValue()), f + delta);
  }
  await fineDial.scrollIntoViewIfNeeded();
  const fineBox = await fineDial.boundingBox();
  const fineBefore = +(await page.locator("#frequency").inputValue());
  await page.mouse.move(
    fineBox.x + fineBox.width * 0.88,
    fineBox.y + fineBox.height * 0.5,
  );
  await page.mouse.down();
  for (let a = 0; a <= Math.PI / 2; a += Math.PI / 16) {
    await page.mouse.move(
      fineBox.x + fineBox.width * (0.5 + 0.38 * Math.cos(a)),
      fineBox.y + fineBox.height * (0.5 + 0.38 * Math.sin(a)),
    );
  }
  await page.mouse.up();
  assert.ok(+(await page.locator("#frequency").inputValue()) > fineBefore);
  await healthy(
    "fine tuning buttons, keyboard and mouse dial preserve real audio/waterfall",
  );
  assert.ok(
    await page.evaluate(
      () =>
        window.__audio === window.__originalAudio &&
        window.__analyser === window.__originalAnalyser &&
        window.__sockets.at(-1) === window.__originalSocket,
    ),
  );

  for (const selector of [".scope canvas", ".fall canvas"]) {
    const canvas = page.locator(selector);
    await canvas.evaluate((el) =>
      el.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    const v = await viewport(),
      b = await canvas.boundingBox();
    await page.mouse.click(b.x + b.width * 0.62, b.y + b.height * 0.5);
    assert.ok(
      Math.abs(
        +(await page.locator("#frequency").inputValue()) -
          (v.start + v.span * 0.62),
      ) < 0.01,
    );
    await healthy("mouse click tunes " + selector);
    const dragView = await viewport();
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.58, b.y + b.height * 0.5, {
      steps: 8,
    });
    await page.mouse.up();
    assert.ok(
      Math.abs(
        +(await page.locator("#frequency").inputValue()) -
          (dragView.start + dragView.span * 0.58),
      ) < 0.01,
    );
    await healthy("mouse drag tunes " + selector);
  }
  const colors = await page.locator(".fall canvas").evaluate((c) => {
    const bytes = c.getContext("2d").getImageData(0, 0, c.width, 1).data;
    const colors = new Set();
    for (let i = 0; i < bytes.length; i += 4)
      colors.add(Array.from(bytes.slice(i, i + 4)).join(","));
    return colors.size;
  });
  assert.ok(colors > 5, "waterfall renders varied real Kiwi data");

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
  for (const mode of ["AM", "USB", "LSB", "CW", "FM", "USB"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await page.waitForFunction(
      (m) => window.__commands.at(-1)?.mode === m,
      mode,
    );
    await healthy("real PCM and waterfall in " + mode);
  }
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
  let fineView = await viewport();
  await fine
    .getByRole("button", { name: "Zoom +", exact: true })
    .press("Enter");
  await changedView(fineView);
  assert.equal((await viewport()).zoom, fineView.zoom + 1);
  await healthy("under-waterfall Zoom + keyboard button");
  await fine.getByRole("button", { name: "Zoom −", exact: true }).click();
  await healthy("under-waterfall Zoom − button");
  assert.equal((await viewport()).zoom, fineView.zoom);
  await page
    .getByRole("button", { name: "Панорама вправо", exact: true })
    .click();
  await healthy("pan before center tuning");
  fineView = await viewport();
  await fine
    .getByRole("button", { name: "Настроиться на центр обзора", exact: true })
    .click();
  assert.ok(
    Math.abs(
      +(await page.locator("#frequency").inputValue()) -
        (fineView.start + fineView.span / 2),
    ) < 0.01,
  );
  await healthy("under-waterfall Center tunes current view midpoint");
  await page.locator("#frequency").fill("7074");
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await fine.getByRole("button", { name: "К частоте", exact: true }).click();
  await healthy("under-waterfall recenter restores VFO overview");
  assert.ok(
    await page.evaluate(
      () =>
        window.__audio === window.__originalAudio &&
        window.__analyser === window.__originalAnalyser &&
        window.__sockets.at(-1) === window.__originalSocket &&
        document.querySelector(".scope canvas") === window.__originalSpectrum &&
        document.querySelector(".fall canvas") === window.__originalWaterfall,
    ),
  );
  checks.push(
    "tuning/pan/zoom reuse original canvases, audio worklet and socket",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFine = fine.getByRole("button", {
    name: "Точная подстройка: частота плюс шаг",
    exact: true,
  });
  await mobileFine.scrollIntoViewIfNeeded();
  let mobileBox = await mobileFine.boundingBox();
  let mobileFrequency = +(await page.locator("#frequency").inputValue());
  await page.touchscreen.tap(
    mobileBox.x + mobileBox.width / 2,
    mobileBox.y + mobileBox.height / 2,
  );
  assert.equal(
    +(await page.locator("#frequency").inputValue()),
    mobileFrequency + 1,
  );
  await touchRotate(fineDial);
  assert.notEqual(
    +(await page.locator("#frequency").inputValue()),
    mobileFrequency + 1,
  );
  await healthy("fine tuning touch button and touch VFO drag");
  for (const selector of [".scope canvas", ".fall canvas"]) {
    const target = page.locator(selector);
    await target.evaluate((el) =>
      el.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    const b = await target.boundingBox(),
      v = await viewport();
    await page.touchscreen.tap(b.x + b.width * 0.4, b.y + b.height * 0.5);
    assert.ok(
      Math.abs(
        +(await page.locator("#frequency").inputValue()) -
          (v.start + v.span * 0.4),
      ) < 0.01,
    );
    await healthy("touch tap tunes " + selector);
  }
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
    await chooseReceiver(process.env.TEST_SECOND_RECEIVER);
    await healthy("switch to another public KiwiSDR");
    await chooseReceiver(testReceiver);
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
    assert.ok(
      await page.evaluate(() => {
        const spectrum = document
          .querySelector(".scope")
          .getBoundingClientRect();
        const waterfall = document
          .querySelector(".fall")
          .getBoundingClientRect();
        return (
          spectrum.height + waterfall.height >= 380 &&
          document.querySelectorAll(".scope canvas").length === 1 &&
          document.querySelectorAll(".fall canvas").length === 1
        );
      }),
      "one full-height panorama at " + width,
    );
    for (const button of await fine.getByRole("button").all())
      assert.ok((await button.boundingBox()).height >= 44);
    await page
      .locator(".visual")
      .screenshot({ path: `artifacts/malachite-${name}.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/sdr-${name}.png`,
      fullPage: true,
    });
  }
  checks.push("320/390/820/1440 layouts without overflow");
  assert.ok(
    await page.evaluate(() => {
      const tuner = document.querySelector(".tuner");
      return (
        tuner.nextElementSibling.matches(".visual") &&
        Array.from(tuner.children)
          .map((e) => e.classList[0])
          .join(",") === "frequency,vfo-control,steps,mode,smeter" &&
        document.querySelector(".fall").nextElementSibling.matches(".fine-tune")
      );
    }),
  );
  const qsl = page.locator(".qsl-card img");
  for (const image of await qsl.all())
    assert.equal(await image.getAttribute("src"), "/ur4mtn-qsl.jpg");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(
    await page.evaluate(() =>
      [".panel", ".header-right .dot.live", ".radio-rings i"].every(
        (selector) =>
          getComputedStyle(document.querySelector(selector)).animationName ===
          "none",
      ),
    ),
  );
  checks.push("radio order, original QSL and reduced motion");

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
