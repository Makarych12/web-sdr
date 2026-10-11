import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const repro = process.env.TEST_REPRO === "1";
const terminationOnly = process.env.TEST_TERMINATION_ONLY === "1";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  hasTouch: true,
  viewport: { width: 1440, height: 1800 },
});
const page = await context.newPage();
const checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.text().includes("WebSDR lifecycle")) console.log(m.text());
});
await page.addInitScript(() => {
  localStorage.setItem("wave.receiver", JSON.stringify("niendorf"));
  window.vfo = {
    resets: [],
    commands: [],
    samples: 0,
    telemetry: [],
    contexts: [],
    nodes: [],
    sockets: [],
    events: [],
    drawsInInput: 0,
    inInput: false,
  };
  const Socket = WebSocket;
  window.WebSocket = class extends Socket {
    constructor(...args) {
      super(...args);
      window.vfo.sockets.push(this);
    }
    send(raw) {
      window.vfo.commands.push({ at: performance.now(), raw });
      super.send(raw);
    }
  };
  const Audio = AudioContext;
  window.AudioContext = class extends Audio {
    constructor(...args) {
      super(...args);
      window.vfo.contexts.push(this);
    }
  };
  const Worklet = AudioWorkletNode;
  window.AudioWorkletNode = class extends Worklet {
    constructor(...args) {
      super(...args);
      window.vfo.nodes.push(this);
      const post = this.port.postMessage.bind(this.port);
      this.port.postMessage = (data, ...rest) => {
        if (data.reset) window.vfo.resets.push(performance.now());
        if (data.rate) window.vfo.inputRate = data.rate;
        if (data.samples) window.vfo.samples++;
        return post(data, ...rest);
      };
      this.port.addEventListener("message", (e) => {
        if (e.data.type === "playback")
          window.vfo.telemetry.push({ ...e.data, at: performance.now() });
      });
      this.port.start();
    }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    if (this instanceof GainNode && args[0] === this.context.destination) {
      window.vfo.gain = this;
      window.vfo.output = this.context.createAnalyser();
      connect.call(this, window.vfo.output);
    }
    return connect.apply(this, args);
  };
  for (const method of ["drawImage", "putImageData"]) {
    const native = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function (...args) {
      if (
        window.vfo.inInput &&
        this.canvas.matches(".scope canvas,.fall canvas")
      )
        window.vfo.drawsInInput++;
      return native.apply(this, args);
    };
  }
  for (const type of [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "wheel",
  ])
    document.addEventListener(
      type,
      (e) => {
        if (!e.target.closest(".vfo-dial")) return;
        if (type === "pointerdown") window.vfo.pointerId = e.pointerId;
        window.vfo.inInput = true;
        if (["pointerup", "pointercancel", "lostpointercapture"].includes(type))
          window.vfo.events.push({ type, at: performance.now() });
        queueMicrotask(() => {
          window.vfo.inInput = false;
        });
      },
      true,
    );
  window.vfoSnapshot = () => {
    const v = window.vfo;
    const pcm = new Float32Array(v.output?.fftSize || 2048);
    v.output?.getFloatTimeDomainData(pcm);
    const last = v.telemetry.at(-1) || {};
    return {
      at: performance.now(),
      frequency: +document.querySelector("#frequency").value,
      resets: v.resets.length,
      samples: v.samples,
      played: last.playedFrames || 0,
      underflow: last.underflowFrames || 0,
      buffered: last.buffered || 0,
      rate: v.contexts[0]?.sampleRate,
      inputRate: v.inputRate,
      state: v.contexts[0]?.state,
      gain: v.gain?.gain.value,
      contexts: v.contexts.length,
      nodes: v.nodes.length,
      sockets: v.sockets.length,
      activeSockets: v.sockets.filter((s) => s.readyState === 1).length,
      auth: v.commands.filter((c) => c.raw.startsWith("SET auth")).length,
      rows: +document.querySelector(".fall canvas").dataset.rows,
      wfSequence: +document.querySelector(".fall canvas").dataset.sequence,
      nonzero: pcm.some((x) => Math.abs(x) > 1e-7),
      drawsInInput: v.drawsInInput,
    };
  };
});
async function healthy() {
  await page.waitForFunction(
    () =>
      window.vfoSnapshot().nonzero &&
      window.vfoSnapshot().rows > 5 &&
      window.vfoSnapshot().played > 0,
    null,
    { timeout: 90000 },
  );
}
async function snapshot() {
  return page.evaluate(() => window.vfoSnapshot());
}
const dial = page.getByRole("slider", {
  name: "VFO — ручка настройки",
  exact: true,
});
async function phase(mode, input) {
  await dial.scrollIntoViewIfNeeded();
  await dial.focus();
  const before = await snapshot(),
    points = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      points.push(await snapshot());
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const box = await dial.boundingBox(),
    cx = box.x + box.width * 0.5,
    cy = box.y + box.height * 0.5,
    r = box.width * 0.35;
  const cdp = input === "touch" ? await context.newCDPSession(page) : null;
  if (input === "mouse") {
    await page.mouse.move(cx + r, cy);
    await page.mouse.down();
  }
  if (cdp)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: cx + r, y: cy, id: 1 }],
    });
  const started = Date.now();
  let angle = 0,
    i = 0;
  while (Date.now() - started < 20000) {
    const sign = Math.floor(i / 8) % 2 === 0 ? 1 : -1;
    if (!repro && i % 80 === 0) {
      const step = ["0.001", "0.01", "0.1", "1", "5", "10"][
        Math.floor(i / 80) % 6
      ];
      await page
        .getByLabel("Шаг настройки", { exact: true })
        .selectOption(step);
      await dial.focus();
    }
    angle += (sign * Math.PI) / 12;
    if (input === "wheel")
      await dial.evaluate(
        (el, sign) =>
          el.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY: -sign * 100,
              bubbles: true,
              cancelable: true,
            }),
          ),
        sign,
      );
    if (input === "mouse")
      await page.mouse.move(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    if (cdp)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), id: 1 },
        ],
      });
    i++;
    await new Promise((r) => setTimeout(r, 25));
  }
  const during = await snapshot();
  if (input === "mouse") await page.mouse.up();
  if (cdp) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  }
  sampling = false;
  await sampler;
  await page.waitForTimeout(1500);
  const after = await snapshot();
  const trace = await page.evaluate((at) => {
    const tunes = window.vfo.commands.filter(
      (c) => c.at >= at && c.raw.startsWith("SET mod="),
    );
    const last = tunes.at(-1),
      events = window.vfo.events.filter((e) => e.at >= at);
    return {
      tunes: tunes.length,
      lastFrequency: last ? +last.raw.match(/freq=([\d.]+)/)[1] : null,
      lastCommand: last,
      events,
    };
  }, before.at);
  const advancing = points
    .slice(1)
    .filter((p, j) => p.played > points[j].played).length;
  const nonzero = points.filter((p) => p.nonzero).length;
  const result = {
    mode,
    input,
    durationMs: during.at - before.at,
    events: i,
    before,
    during,
    after,
    advancingTelemetry: advancing,
    nonzeroSnapshots: nonzero,
    totalSnapshots: points.length,
    trace,
  };
  checks.push(result);
  console.log(
    JSON.stringify({
      mode,
      input,
      resetDelta: during.resets - before.resets,
      playedDelta: during.played - before.played,
      nonzero,
      total: points.length,
    }),
  );
  if (repro) {
    assert.ok(
      during.samples - before.samples > 100,
      "real PCM must arrive while tuning",
    );
    assert.ok(during.resets - before.resets > 100, "reproduce queue resets");
    assert.ok(
      nonzero < points.length * 0.15,
      "reproduce sustained silence while moving",
    );
    assert.ok(after.played > during.played, "audio returns after stopping");
  } else {
    assert.equal(during.resets, before.resets, "tuning must not clear PCM");
    assert.ok(
      during.played - before.played > before.rate * 17,
      "worklet must play throughout 20s tuning",
    );
    assert.ok(
      nonzero > points.length * 0.75,
      "real output must remain audible during motion",
    );
    assert.equal(during.contexts, before.contexts);
    assert.equal(during.nodes, before.nodes);
    assert.equal(during.sockets, before.sockets);
    assert.equal(during.auth, before.auth);
    assert.equal(during.state, "running");
    assert.equal(during.gain, before.gain);
    assert.equal(during.activeSockets, 2);
    assert.equal(
      trace.lastFrequency,
      after.frequency,
      "last Kiwi frequency equals exact displayed frequency",
    );
    assert.ok(during.wfSequence > before.wfSequence, "WF keeps arriving");
    assert.equal(
      during.drawsInInput,
      before.drawsInInput,
      "full canvas drawing stays outside input handlers",
    );
  }
}
async function checkTerminationEvents() {
  const visual = await page.evaluate(() => {
    const canvas = document.querySelector(".scope canvas");
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let coloredTracePixels = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 1] > 80 || pixels[i + 2] > 80) coloredTracePixels++;
    return {
      label: "real spectrum and waterfall",
      coloredTracePixels,
      waterfallRows: +document.querySelector(".fall canvas").dataset.rows,
      snapshot: window.vfoSnapshot(),
    };
  });
  assert.ok(visual.coloredTracePixels > 0);
  assert.ok(visual.waterfallRows > 5);
  assert.ok(visual.snapshot.nonzero);
  checks.push(visual);
  await page.getByLabel("Шаг настройки", { exact: true }).selectOption("0.001");
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    await dial.scrollIntoViewIfNeeded();
    const box = await dial.boundingBox();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5);
    await page.mouse.down();
    const result = await dial.evaluate((el, type) => {
      const before = window.vfoSnapshot();
      const b = el.getBoundingClientRect(),
        cx = b.x + b.width * 0.5,
        cy = b.y + b.height * 0.5,
        r = b.width * 0.35;
      for (const angle of [Math.PI / 6, Math.PI / 3]) {
        el.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId: window.vfo.pointerId,
            pointerType: "mouse",
            clientX: cx + r * Math.cos(angle),
            clientY: cy + r * Math.sin(angle),
          }),
        );
      }
      const at = performance.now();
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: window.vfo.pointerId,
          pointerType: "mouse",
        }),
      );
      const after = window.vfoSnapshot();
      const command = window.vfo.commands
        .filter((c) => c.at >= at && c.raw.startsWith("SET mod="))
        .at(-1);
      return { type, before, after, flushMs: command?.at - at, command };
    }, type);
    await page.mouse.up();
    assert.ok(
      result.flushMs >= 0 && result.flushMs < 10,
      "terminal pointer event immediately flushes pending tune",
    );
    assert.equal(
      +result.command.raw.match(/freq=([\d.]+)/)[1],
      result.after.frequency,
    );
    assert.equal(result.after.resets, result.before.resets);
    const commandsBefore = await page.evaluate(
      () =>
        window.vfo.commands.filter((c) => c.raw.startsWith("SET mod=")).length,
    );
    await page.waitForTimeout(120);
    assert.equal(
      await page.evaluate(
        () =>
          window.vfo.commands.filter((c) => c.raw.startsWith("SET mod="))
            .length,
      ),
      commandsBefore,
      "no deferred tune after final flush",
    );
    checks.push(result);
    console.log("PASS final flush", type, result.flushMs);
  }
}
try {
  await page.goto(process.env.TEST_APP_URL || "http://127.0.0.1:8787");
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await page.locator(".connect").click();
  try {
    await healthy();
  } catch (e) {
    console.log(
      await page.evaluate(() => ({
        snapshot: window.vfoSnapshot(),
        status: document.querySelector(".header-right").textContent,
        error: document.querySelector(".error")?.textContent,
        telemetry: window.vfo.telemetry.slice(-3),
      })),
    );
    throw e;
  }
  await page.getByLabel("Шаг настройки", { exact: true }).selectOption("0.001");
  if (terminationOnly) {
    await checkTerminationEvents();
  } else if (repro) {
    await phase("AM", "wheel");
  } else {
    for (const mode of ["AM", "USB", "LSB", "CW", "FM"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await healthy();
      for (const input of ["mouse", "wheel", "touch"]) await phase(mode, input);
      for (const step of ["0.001", "0.01", "0.1", "1", "5", "10"]) {
        await page
          .getByLabel("Шаг настройки", { exact: true })
          .selectOption(step);
        const before = await snapshot();
        for (const name of ["Шаг частоты вверх", "Шаг частоты вниз"]) {
          await page.getByRole("button", { name, exact: true }).click();
          await page.waitForTimeout(60);
        }
        const after = await snapshot();
        assert.equal(after.frequency, before.frequency);
        assert.equal(after.resets, before.resets);
        checks.push({
          mode,
          input: "step buttons",
          stepHz: +step * 1000,
          before,
          after,
        });
      }
      const latest = await snapshot();
      assert.ok(
        latest.buffered / latest.inputRate < 0.75,
        "no accumulating latency after a minute of active tuning",
      );
    }
  }
  await page.locator(".connect").click();
  assert.deepEqual(errors, []);
  console.log(
    terminationOnly
      ? "PASS final pointer events flush without clearing audio"
      : repro
        ? "PASS reproduced VFO audio regression"
        : "PASS uninterrupted real VFO audio in all modes",
  );
} finally {
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    `artifacts/vfo-audio-${terminationOnly ? "events" : repro ? "before" : "after"}.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
