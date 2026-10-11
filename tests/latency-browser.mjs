import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });
const appUrl = process.env.TEST_APP_URL || "http://127.0.0.1:8787";
const checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem("wave.receiver", JSON.stringify("niendorf"));
  window.trace = [];
  window.sockets = [];
  window.resets = [];
  window.pcm = [];
  window.wf = [];
  const Socket = WebSocket;
  window.WebSocket = class extends Socket {
    constructor(...args) {
      super(...args);
      window.sockets.push(this);
      window.trace.push({ type: "socket-create", at: performance.now() });
      this.addEventListener("message", (e) => {
        if (e.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(e.data);
          if (bytes[0] === 1) window.pcm.push(performance.now());
          if (bytes[0] === 2) window.wf.push(performance.now());
        }
      });
    }
    send(raw) {
      try {
        window.trace.push({ ...JSON.parse(raw), at: performance.now() });
      } catch {}
      super.send(raw);
    }
    close(...args) {
      window.trace.push({ type: "socket-close", at: performance.now() });
      super.close(...args);
    }
  };
  const Node = AudioWorkletNode;
  window.AudioWorkletNode = class extends Node {
    constructor(...args) {
      super(...args);
      const post = this.port.postMessage.bind(this.port);
      this.port.postMessage = (data, ...rest) => {
        if (data.reset) window.resets.push(performance.now());
        return post(data, ...rest);
      };
    }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    if (this instanceof GainNode && args[0] === this.context.destination) {
      window.output = this.context.createAnalyser();
      connect.call(this, window.output);
    }
    return connect.apply(this, args);
  };
  document.addEventListener(
    "pointerup",
    (e) => {
      if (e.target.closest(".vfo-dial")) window.releaseAt = performance.now();
    },
    true,
  );
});
async function healthy() {
  await page.waitForFunction(
    () => {
      if (
        !window.pcm.length ||
        !window.wf.length ||
        !window.output ||
        +document.querySelector(".fall canvas").dataset.rows < 3
      )
        return false;
      const samples = new Float32Array(window.output.fftSize);
      window.output.getFloatTimeDomainData(samples);
      return (
        samples.some((x) => Math.abs(x) > 1e-6) &&
        document.querySelector(".header-right").textContent.includes("В эфире")
      );
    },
    null,
    { timeout: 45000 },
  );
}
async function measure(label, selector, action, expectedFrequency) {
  const start = await page.evaluate(
    ({ selector, action }) => {
      window.actionAt = performance.now();
      const el = document.querySelector(selector);
      if (action === "click") el.click();
      else {
        el.value = action;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return window.actionAt;
    },
    { selector, action },
  );
  const frame = await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          resolve({
            at: performance.now(),
            frequency: +document.querySelector("#frequency").value,
          }),
        ),
      ),
  );
  await page.waitForFunction(
    (start) => window.trace.some((e) => e.type === "tune" && e.at >= start),
    start,
  );
  const command = await page.evaluate(
    (start) => window.trace.find((e) => e.type === "tune" && e.at >= start),
    start,
  );
  assert.ok(command.at - start <= 100, label);
  if (expectedFrequency !== undefined)
    assert.equal(frame.frequency, expectedFrequency);
  checks.push({
    label,
    uiAtNextFrameMs: frame.at - start,
    tuneSendMs: command.at - start,
    frequency: frame.frequency,
    command,
  });
}
try {
  // Exercise the original gateway with real Kiwi data, never a mock receiver.
  await page.route("**/api/receivers", async (route) => {
    const response = await route.fetch(),
      rows = await response.json();
    for (const row of rows) delete row.directUrl;
    await route.fulfill({ response, json: rows });
  });
  await page.goto(appUrl);
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  const started = await page.evaluate(() => {
    const at = performance.now();
    document.querySelector(".connect").click();
    return at;
  });
  await healthy();
  checks.push(
    await page.evaluate(
      (start) => ({
        label: "first connection",
        socketCreateMs:
          window.trace.find((e) => e.type === "socket-create").at - start,
        firstPCMms: window.pcm[0] - start,
        firstWFms: window.wf[0] - start,
      }),
      started,
    ),
  );
  assert.equal(
    await page.evaluate(
      () => window.sockets.filter((s) => s.readyState === 1).length,
    ),
    1,
  );
  for (const [band, frequency] of [
    [40, 7100],
    [20, 14200],
    [40, 7100],
    [160, 1840],
    [80, 3750],
    [30, 10120],
    [17, 18100],
    [15, 21200],
    [12, 24920],
    [10, 28400],
  ]) {
    const index = await page
      .locator(".band-selector button")
      .evaluateAll(
        (buttons, band) =>
          buttons.findIndex((b) => b.textContent.startsWith(band + "m")),
        band,
      );
    await measure(
      band + "m band",
      `.band-selector button:nth-child(${index + 1})`,
      "click",
      frequency,
    );
  }
  for (const [i, mode] of ["AM", "USB", "LSB", "CW", "FM"].entries()) {
    await measure(
      mode + " modulation",
      `.modes button:nth-child(${i + 1})`,
      "click",
    );
    assert.equal(checks.at(-1).command.mode, mode);
  }
  await page.getByRole("button", { name: "USB", exact: true }).click();
  await measure("filter", "#filter-width", "1800");
  await measure("AGC", "#agc", "fast");
  const dial = page.getByRole("slider", {
    name: "VFO — ручка настройки",
    exact: true,
  });
  for (const step of [0.001, 0.01, 0.1, 1, 5, 10]) {
    await page
      .getByLabel("Шаг настройки", { exact: true })
      .selectOption(String(step));
    await dial.focus();
    for (const direction of [-1, 1]) {
      const result = await dial.evaluate(
        async (el, { step, direction }) => {
          const before = +document.querySelector("#frequency").value,
            at = performance.now();
          const uiCommits = [];
          for (let i = 0; i < 20; i++) {
            const tickAt = performance.now();
            el.dispatchEvent(
              new WheelEvent("wheel", {
                deltaY: direction * 100,
                bubbles: true,
                cancelable: true,
              }),
            );
            uiCommits.push({
              ms: performance.now() - tickAt,
              frequency: +document.querySelector("#frequency").value,
              expected:
                Math.round((before - direction * (i + 1) * step) * 1000) / 1000,
            });
          }
          const burstMs = performance.now() - at;
          const frame = await new Promise((resolve) =>
            requestAnimationFrame(() =>
              resolve({
                at: performance.now(),
                frequency: +document.querySelector("#frequency").value,
              }),
            ),
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
          const commands = window.trace.filter(
            (e) => e.type === "tune" && e.at >= at,
          );
          return {
            label: "20 VFO ticks",
            uiCommits,
            burstMs,
            maxUIcommitMs: Math.max(...uiCommits.map((v) => v.ms)),
            stepHz: step * 1000,
            direction,
            uiAtNextFrameMs: frame.at - at,
            frequency: frame.frequency,
            expected:
              Math.round((before - direction * 20 * step) * 1000) / 1000,
            sends: commands.map((e) => ({
              ms: e.at - at,
              frequency: e.frequency,
            })),
            sockets: window.sockets.length,
          };
        },
        { step, direction },
      );
      for (const tick of result.uiCommits)
        assert.equal(tick.frequency, tick.expected);
      assert.equal(result.frequency, result.expected);
      assert.equal(result.sends.at(-1).frequency, result.expected);
      assert.ok(result.sends.at(-1).ms <= 100);
      assert.ok(result.sends.length <= Math.ceil(result.burstMs / 40) + 1);
      checks.push(result);
    }
  }
  await dial.scrollIntoViewIfNeeded();
  const box = await dial.boundingBox();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(
      box.x + box.width * (0.5 + 0.35 * Math.cos((i * Math.PI) / 24)),
      box.y + box.height * (0.5 + 0.35 * Math.sin((i * Math.PI) / 24)),
    );
  await page.mouse.up();
  const release = await page.evaluate(() => ({
    label: "VFO release",
    flushMs:
      window.trace.find((e) => e.type === "tune" && e.at >= window.releaseAt)
        .at - window.releaseAt,
    frequency: +document.querySelector("#frequency").value,
  }));
  assert.ok(release.flushMs < 10);
  checks.push(release);
  const sendsAtRelease = await page.evaluate(
    () => window.trace.filter((e) => e.type === "tune").length,
  );
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(
      () => window.trace.filter((e) => e.type === "tune").length,
    ),
    sendsAtRelease,
  );
  const beforePan = await page.evaluate(() => ({
    resets: window.resets.length,
    sockets: window.sockets.length,
  }));
  await page.getByLabel("Масштаб waterfall", { exact: true }).fill("7");
  await page.getByLabel("Центр waterfall", { exact: true }).evaluate((el) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(el, "28000");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(100);
  assert.deepEqual(
    await page.evaluate(() => ({
      resets: window.resets.length,
      sockets: window.sockets.length,
    })),
    beforePan,
  );
  checks.push({ label: "zoom/pan preserves audio queue and connection" });
  const socketsBefore = await page.evaluate(() => window.sockets.length);
  await page.evaluate(() => window.sockets.at(-1).close());
  await page.waitForFunction(
    (n) => window.sockets.length === n + 1,
    socketsBefore,
  );
  await healthy();
  checks.push({
    label: "forced WebSocket disconnect automatically reconnects",
  });
  const stopped = await page.evaluate(() => {
    const at = performance.now();
    document.querySelector(".connect").click();
    return {
      at,
      closeMs: window.trace.at(-1).at - at,
      sockets: window.sockets.length,
    };
  });
  assert.ok(stopped.closeMs < 10);
  checks.push({ label: "manual disconnect", ...stopped });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1200);
  assert.equal(
    await page.evaluate(() => window.sockets.length),
    stopped.sockets,
  );
  const restart = await page.evaluate(() => {
    window.pcm = [];
    window.wf = [];
    const at = performance.now();
    document.querySelector(".connect").click();
    return at;
  });
  await healthy();
  checks.push(
    await page.evaluate(
      (at) => ({
        label: "manual restart",
        socketCreateMs:
          window.trace.find((e) => e.type === "socket-create" && e.at >= at)
            .at - at,
        firstPCMms: window.pcm[0] - at,
        firstWFms: window.wf[0] - at,
        activeSockets: window.sockets.filter((s) => s.readyState === 1).length,
      }),
      restart,
    ),
  );
  const socketsBeforeVisibility = await page.evaluate(
    () => window.sockets.length,
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(
    await page.evaluate(() => window.sockets.length),
    socketsBeforeVisibility,
  );
  const rows = await (
    await page.request.get(new URL("/api/receivers", appUrl).href)
  ).json();
  for (const id of ["zl2p", "niendorf"]) {
    const receiver = rows.find((r) => r.id === id);
    await page.getByRole("button", { name: "Приёмник", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Поиск приёмников" })
      .fill(receiver.name);
    const switchedAt = await page
      .locator(".catalog-item")
      .first()
      .evaluate((el) => {
        window.pcm = [];
        window.wf = [];
        const at = performance.now();
        el.click();
        return at;
      });
    await healthy();
    const result = await page.evaluate(
      ({ at, id }) => ({
        label: "server switch",
        receiver: id,
        closeMs:
          window.trace.find((e) => e.type === "socket-close" && e.at >= at).at -
          at,
        openMs:
          window.trace.find((e) => e.type === "socket-create" && e.at >= at)
            .at - at,
        firstPCMms: window.pcm[0] - at,
        firstWFms: window.wf[0] - at,
        activeSockets: window.sockets.filter((s) => s.readyState === 1).length,
      }),
      { at: switchedAt, id },
    );
    assert.ok(result.openMs < 100);
    assert.equal(result.activeSockets, 1);
    assert.ok(
      await page.evaluate(
        (at) => window.resets.some((t) => t >= at),
        switchedAt,
      ),
    );
    checks.push(result);
  }
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 1800 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    checks.push({ label: "mobile no overflow", width });
  }
  await page.locator(".connect").click();
  assert.deepEqual(errors, []);
  console.log("PASS", JSON.stringify(checks, null, 2));
} finally {
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/latency-browser-report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
