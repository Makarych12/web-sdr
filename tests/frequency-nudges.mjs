import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.env.TEST_APP_URL || "http://localhost:5173";
const dir = process.env.TEST_ARTIFACT_DIR || "artifacts/frequency-nudges";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const report = { url, cases: [], errors: [] };
const deltas = [-10000, -1000, -100, 100, 1000, 10000];
try {
  for (const width of (process.env.TEST_WIDTHS || "1440,390,360")
    .split(",")
    .map(Number)) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 800 },
      hasTouch: true,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    await page.addInitScript(() => {
      window.__nudgeCommands = [];
      const W = WebSocket;
      window.WebSocket = class extends W {
        send(value) {
          if (typeof value === "string" && value.startsWith("SET mod="))
            window.__nudgeCommands.push(value);
          super.send(value);
        }
      };
    });
    await page.goto(url + "/#listen");
    await page.waitForFunction(
      () => +document.querySelector(".receiver-choice")?.dataset.count > 0,
    );
    const input = page.locator("#frequency");
    const buttons = page.locator(".frequency-nudges button");
    await input.fill("14200.251");
    await input.press("Enter");
    await page.getByRole("button", { name: "USB", exact: true }).click();
    await page.locator(".receiver .connect").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".header-right").textContent.includes("В эфире"),
      null,
      { timeout: 90000 },
    );
    async function frequency() {
      return Number(
        await page.locator(".vfo-dial").first().getAttribute("aria-valuenow"),
      );
    }
    async function set(hz) {
      await input.fill(String(hz / 1000));
      await input.press("Enter");
      assert.equal(await frequency(), hz);
    }
    async function synchronized(hz) {
      assert.deepEqual(
        await page
          .locator(".vfo-dial")
          .evaluateAll((es) => es.map((e) => +e.getAttribute("aria-valuenow"))),
        [hz, hz],
      );
      assert.equal(Math.round(Number(await input.inputValue()) * 1000), hz);
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
      await page.waitForFunction((hz) => {
        const last = window.__nudgeCommands.at(-1);
        const m = last?.match(/ freq=(\d+)\.(\d{3})$/);
        return m && Number(m[1]) * 1000 + Number(m[2]) === hz;
      }, hz);
      const view = await page.locator(".visual").evaluate((e) => ({
        start: +e.dataset.start,
        span: +e.dataset.span,
        positions: [...e.querySelectorAll(".marker")].map((m) =>
          parseFloat(m.style.left),
        ),
      }));
      // The last real Kiwi FFT bin can fall a few Hz below the 30 MHz VFO
      // limit. A carrier outside that reported view has no on-canvas marker.
      const inView =
        hz / 1000 >= view.start && hz / 1000 <= view.start + view.span;
      assert.equal(view.positions.length, inView ? 2 : 0);
      if (hz > 0 && hz < 30000000) assert.ok(inView);
      for (const left of view.positions)
        assert.ok(
          Math.abs(left - ((hz / 1000 - view.start) / view.span) * 100) < 0.001,
        );
    }
    assert.equal(await buttons.count(), 6);
    assert.deepEqual(await buttons.allTextContents(), [
      "---",
      "--",
      "-",
      "+",
      "++",
      "+++",
    ]);
    const checks = [];
    for (let i = 0; i < deltas.length; i++) {
      const delta = deltas[i];
      await set(14200251);
      const before = await page.evaluate(() => window.__nudgeCommands.length);
      if (width === 1440) await buttons.nth(i).click();
      else await buttons.nth(i).tap();
      await synchronized(14200251 + delta);
      await page.waitForTimeout(150);
      assert.equal(
        await frequency(),
        14200251 + delta,
        "touch/click must change frequency only once",
      );
      assert.equal(
        await page.evaluate(() => window.__nudgeCommands.length),
        before + 1,
        "one activation must send one native tune",
      );
      for (const start of [51, 29999951]) {
        await set(start);
        await buttons.nth(i).click();
        await synchronized(Math.max(0, Math.min(30000000, start + delta)));
      }
      checks.push({
        delta,
        exactHz: true,
        boundaries: true,
        singleActivation: true,
      });
    }
    await set(14200251);
    await buttons.nth(3).scrollIntoViewIfNeeded();
    const box = await buttons.nth(3).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal(await frequency(), 14200351);
    await page.waitForTimeout(250);
    assert.equal(await frequency(), 14200351, "no repeat before 400ms");
    await page.waitForTimeout(350);
    assert.ok(
      (await frequency()) >= 14200551,
      "repeat starts after delay and continues",
    );
    await page.mouse.up();
    const released = await frequency();
    await page.waitForTimeout(250);
    assert.equal(
      await frequency(),
      released,
      "release stops repetition immediately",
    );
    await synchronized(released);
    // Native CDP touch hold also exercises the compatibility click on release.
    const cdp = await context.newCDPSession(page);
    await set(14200251);
    const touchBox = await buttons.nth(2).boundingBox();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          x: touchBox.x + touchBox.width / 2,
          y: touchBox.y + touchBox.height / 2,
          id: 1,
        },
      ],
    });
    await page.waitForTimeout(550);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const touchReleased = await frequency();
    assert.ok(touchReleased <= 14200051);
    await page.waitForTimeout(250);
    assert.equal(await frequency(), touchReleased);
    await synchronized(touchReleased);
    await set(14200251);
    await buttons.nth(3).focus();
    await page.keyboard.press("Enter");
    await synchronized(14200351);
    // Cancellation and focus loss must not leave a background repeater.
    for (const reason of ["pointercancel", "lostpointercapture", "blur"]) {
      await page.mouse.down();
      if (reason === "blur")
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      else
        await buttons
          .nth(2)
          .dispatchEvent(reason, { pointerId: 1, pointerType: "mouse" });
      await page.mouse.up();
      const stopped = await frequency();
      await page.waitForTimeout(450);
      assert.equal(await frequency(), stopped, reason + " stops repetition");
    }
    await page
      .locator(".frequency")
      .screenshot({ path: `${dir}/buttons-${width}.png` });
    const layout = await buttons.evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    if (width === 1440)
      assert.equal(
        new Set(layout.map((b) => b.y)).size,
        1,
        "desktop buttons occupy one row",
      );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    report.cases.push({
      width,
      checks,
      hold: true,
      touchHold: true,
      release: true,
      cancellation: true,
      keyboard: true,
      layout,
    });
    console.log(
      `PASS ${width}: six exact deltas, limits, no rounding, single touch, hold/release and native Kiwi commands`,
    );
    await page.locator(".receiver .connect").click();
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
