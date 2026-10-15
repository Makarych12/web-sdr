import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { selectStep } from "./step-control.mjs";

const base = process.env.TEST_APP_URL || "http://localhost:5173";
const dir = process.env.TEST_ARTIFACT_DIR || "artifacts/receiver-regressions";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const report = {
  url: base,
  fixture:
    "Deterministic gateway signal levels; no generated signal in application code",
  widths: [],
  errors: [],
};

async function instrument(page) {
  await page.route("**/api/receivers", (r) =>
    r.fulfill({
      json: [
        {
          id: "fixture",
          name: "UI regression fixture",
          location: "Test",
          users: 0,
          maxUsers: 8,
          apiAvailable: true,
        },
      ],
    }),
  );
  await page.route("**/api/receivers/*/check", (r) =>
    r.fulfill({ json: { reachable: true, responseMs: 1 } }),
  );
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    const probe = (window.__receiverFixture = { commands: [], socket: null });
    window.WebSocket = class FixtureSocket extends EventTarget {
      readyState = 0;
      constructor(url, protocols) {
        super();
        if (new URL(url, location.href).pathname !== "/ws")
          return new NativeSocket(url, protocols);
        probe.socket = this;
        queueMicrotask(() => {
          if (this.readyState !== 0) return;
          this.readyState = 1;
          this.onopen?.({});
        });
      }
      send(raw) {
        const command = JSON.parse(raw);
        probe.commands.push(command);
        if (command.type === "connect" || command.type === "tune") {
          this.config = command;
          queueMicrotask(() => {
            if (this.readyState !== 1) return;
            this.onmessage?.({
              data: JSON.stringify({ ...command, type: "tuned" }),
            });
            if (command.type === "connect") {
              this.onmessage?.({
                data: JSON.stringify({ type: "audio", sampleRate: 12000 }),
              });
              this.frames();
              this.timer = setInterval(() => this.frames(), 1000);
            }
          });
        }
      }
      frames() {
        if (this.readyState !== 1) return;
        const c = this.config,
          span = 30000 / 2 ** c.zoom,
          center = Math.max(
            span / 2,
            Math.min(30000 - span / 2, c.viewCenter ?? c.frequency),
          );
        this.onmessage?.({
          data: JSON.stringify({
            type: "view",
            start: center - span / 2,
            span,
            zoom: c.zoom,
            bandwidth: 30000,
            sequence: (this.sequence = (this.sequence ?? 0) + 1),
          }),
        });
        this.onmessage?.({ data: new Uint8Array([1, 0, 0]).buffer });
        this.onmessage?.({
          data: new Uint8Array(1025).fill(100).map((v, i) => (i === 0 ? 2 : v))
            .buffer,
        });
      }
      close() {
        clearInterval(this.timer);
        this.readyState = 3;
        this.onclose?.({ code: 1000, reason: "fixture close", wasClean: true });
      }
    };
    probe.signal = (rssi) =>
      probe.socket.onmessage?.({
        data: JSON.stringify({ type: "signal", rssi }),
      });
  });
}
async function assertSynchronized(page, hz) {
  assert.deepEqual(
    await page
      .locator(".vfo-dial")
      .evaluateAll((es) =>
        es.map((e) => Number(e.getAttribute("aria-valuenow"))),
      ),
    [hz, hz],
  );
  assert.equal(
    Math.round(Number(await page.locator("#frequency").inputValue()) * 1000),
    hz,
  );
  assert.equal(
    await page
      .locator(".digital-frequency")
      .evaluate((e) => Number(e.textContent.replace(/\D/g, ""))),
    hz,
  );
  assert.equal(
    await page
      .locator(".fine-readout output")
      .evaluate((e) => Number(e.textContent.replace(/\D/g, ""))),
    hz,
  );
  const marker = await page.locator(".visual").evaluate((e) => ({
    start: +e.dataset.start,
    span: +e.dataset.span,
    left: parseFloat(e.querySelector(".scope .marker").style.left),
  }));
  assert.ok(
    Math.abs(marker.left - ((hz / 1000 - marker.start) / marker.span) * 100) <
      0.001,
  );
  const config = await page.evaluate(() =>
    window.__receiverFixture.commands
      .filter((c) => ["tune", "connect"].includes(c.type))
      .at(-1),
  );
  assert.equal(config.frequency, hz / 1000);
}
async function rotate(page, dial, touch, degrees = 105) {
  await dial.scrollIntoViewIfNeeded();
  const box = await dial.boundingBox(),
    cx = box.x + box.width / 2,
    cy = box.y + box.height / 2,
    r = box.width * 0.35;
  const start = Number(await dial.getAttribute("aria-valuenow"));
  const scroll = await page.evaluate(() => scrollY);
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const at = (angle) => ({
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
    id: 1,
  });
  if (touch)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [at(0)],
    });
  else {
    await page.mouse.move(at(0).x, at(0).y);
    await page.mouse.down();
  }
  for (let i = 1; i <= 12; i++) {
    const p = at(((i / 12) * degrees * Math.PI) / 180);
    if (touch)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [p],
      });
    else await page.mouse.move(p.x, p.y);
  }
  if (touch) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else await page.mouse.up();
  assert.equal(
    await page.evaluate(() => scrollY),
    scroll,
    "dial must not scroll the page",
  );
  return Number(await dial.getAttribute("aria-valuenow")) - start;
}
function geometry(page) {
  return page.evaluate(() => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x + scrollX,
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
      };
    };
    return Object.fromEntries(
      [
        ".tuner",
        ".smeter",
        ".smeter-top",
        ".smeter-value",
        ".smeter-top small",
        ".smeter-track",
        ".smeter-scale",
        ".visual",
        ".fine-tune",
      ].map((s) => [s, rect(document.querySelector(s))]),
    );
  });
}
try {
  for (const width of [360, 390, 768, 1440]) {
    const context = await browser.newContext({
      viewport: {
        width,
        height: width === 360 ? 800 : width === 390 ? 844 : 1000,
      },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    await instrument(page);
    await page.clock.install();
    await page.goto(base + "/#listen");
    await page.addStyleTag({
      content: "html {scroll-behavior:auto !important}",
    });
    await page.waitForFunction(
      () => +document.querySelector(".receiver-choice")?.dataset.count > 0,
    );
    assert.equal(await page.locator(".vfo-dial").count(), 2);
    assert.equal(
      await page.locator(".tuner > .vfo-control .vfo-dial").count(),
      1,
    );
    assert.equal(await page.locator(".fall + .fine-tune .vfo-dial").count(), 1);
    const sizes = await page
      .locator(".vfo-dial")
      .evaluateAll((es) =>
        es.map((e) => ({ width: e.offsetWidth, height: e.offsetHeight })),
      );
    const expected = 164;
    assert.deepEqual(sizes, [
      { width: expected, height: expected },
      { width: 86, height: 86 },
    ]);
    await page
      .locator(".tuner")
      .screenshot({ path: `${dir}/tuner-${width}.png` });
    await page
      .locator(".fine-tune")
      .screenshot({ path: `${dir}/fine-${width}.png` });
    const field = page.locator("#frequency");
    await field.fill("7074.251");
    await field.press("Enter");
    for (const mode of ["USB", "LSB"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      assert.match(await page.locator(".step-value").textContent(), /^10 Hz$/);
    }
    await page.getByRole("button", { name: "USB", exact: true }).click();
    await page.locator(".receiver .connect").click();
    await page.waitForFunction(() =>
      document.querySelector(".header-right").textContent.includes("В эфире"),
    );
    const checks = [];
    for (const step of [1, 10, 100, 1000]) {
      await selectStep(page, String(step / 1000));
      for (let i = 0; i < 2; i++) {
        const dial = page.locator(".vfo-dial").nth(i);
        let hz = Number(await dial.getAttribute("aria-valuenow"));
        await dial.press("ArrowUp");
        hz += step;
        await assertSynchronized(page, hz);
        await dial.press("PageDown");
        hz -= 10 * step;
        await assertSynchronized(page, hz);
        await dial.press("PageUp");
        hz += 10 * step;
        await assertSynchronized(page, hz);
        await dial.scrollIntoViewIfNeeded();
        await dial.focus();
        const b = await dial.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.wheel(0, -100);
        await page.waitForFunction(
          (expected) =>
            +document
              .querySelector(".vfo-dial")
              .getAttribute("aria-valuenow") === expected,
          hz + step,
        );
        hz += step;
        await assertSynchronized(page, hz);
        for (const touch of [false, true]) {
          const delta = await rotate(page, dial, touch);
          assert.ok(
            delta >= 15 * step && delta <= 19 * step,
            `${width}/${i}/${step}/${touch}: ${delta}`,
          );
          assert.equal(delta % step, 0);
          hz += delta;
          await assertSynchronized(page, hz);
        }
        checks.push({
          dial: i,
          stepHz: step,
          keyboard: true,
          wheel: true,
          mouse: true,
          touch: true,
        });
      }
    }
    // Cover the intermediate and large steps as well as those explicitly requested.
    if (width === 1440)
      for (const step of [5, 50, 500, 5000, 10000]) {
        await selectStep(page, String(step / 1000));
        for (const dial of await page.locator(".vfo-dial").all()) {
          const before = Number(await dial.getAttribute("aria-valuenow"));
          await dial.press("ArrowUp");
          await assertSynchronized(page, before + step);
        }
      }
    if (width === 1440) {
      await selectStep(page, "0.001");
      for (const dial of await page.locator(".vfo-dial").all())
        for (const touch of [false, true]) {
          const before = Number(await dial.getAttribute("aria-valuenow"));
          const forward = await rotate(page, dial, touch, 420),
            back = await rotate(page, dial, touch, -420);
          assert.ok(forward >= 68 && forward <= 72);
          assert.ok(back <= -68 && back >= -72);
          assert.ok(Math.abs(forward + back) <= 2);
          await assertSynchronized(page, before + forward + back);
        }
    }
    await page.locator(".receiver .connect").click(); // Start with real application "no signal" state.
    const baseline = await geometry(page),
      levels = [];
    await page
      .locator(".tuner")
      .screenshot({ path: `${dir}/meter-${width}-none.png` });
    await page.locator(".receiver .connect").click();
    const cases = [
      ["S1", -121],
      ["S5", -97],
      ["S9", -73],
      ["S9 +10", -63],
      ["S9 +20", -53],
      ["S9 +60", -13],
      ["−84.4 dBm", -84.4],
    ];
    for (const [label, db] of cases) {
      await page.evaluate((db) => window.__receiverFixture.signal(db), db);
      await page.clock.runFor(8000);
      const current = await geometry(page);
      for (const selector of Object.keys(baseline))
        for (const dimension of ["x", "y", "width", "height"])
          assert.ok(
            Math.abs(
              current[selector][dimension] - baseline[selector][dimension],
            ) <= 0.01,
            `${width} ${label} ${selector}.${dimension}: ${current[selector][dimension]} != ${baseline[selector][dimension]}`,
          );
      const text = await page.locator(".smeter-top strong").textContent();
      if (label !== "−84.4 dBm")
        assert.equal(
          (await page.locator(".smeter-value").textContent()).trim(),
          label,
        );
      else assert.match(text, /-84.4 dBm/);
      const styles = await page.locator(".smeter-top strong").evaluate((e) => ({
        wrap: getComputedStyle(e).whiteSpace,
        numeric: getComputedStyle(e).fontVariantNumeric,
      }));
      assert.equal(styles.wrap, "nowrap");
      assert.equal(styles.numeric, "tabular-nums");
      await page.locator(".tuner").screenshot({
        path: `${dir}/meter-${width}-${label.replace(/[^\w]/g, "_")}.png`,
      });
      levels.push({ label, db, geometry: current });
    }
    // Cross the exact text-format boundaries in both directions.
    for (const db of [-97.1, -96.9, -73.1, -72.9, -63.1, -62.9, -13]) {
      await page.evaluate((db) => window.__receiverFixture.signal(db), db);
      await page.clock.runFor(8000);
      assert.deepEqual(await geometry(page), baseline);
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.locator(".receiver .connect").click();
    await page.clock.runFor(1000);
    assert.deepEqual(await geometry(page), baseline);
    report.widths.push({
      width,
      sizes,
      checks,
      levels,
      stableMeterGeometry: true,
    });
    await context.close();
    console.log(
      `PASS ${width}px: both dials, steps, pointer/touch, fixed meter geometry`,
    );
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
