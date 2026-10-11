import { selectStep } from "./step-control.mjs";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.addInitScript(() =>
      document.addEventListener(
        "pointerdown",
        (e) => {
          window.__pointerId = e.pointerId;
        },
        true,
      ),
    );
    await page.goto(process.env.TEST_APP_URL || "http://localhost:8787");
    const dial = page.locator(".vfo-dial").first();
    await dial.waitFor();
    const angles = () =>
      page
        .locator(".vfo-dial")
        .evaluateAll((es) =>
          es.map((e) => parseFloat(e.style.getPropertyValue("--vfo-angle"))),
        );
    const frequency = () => dial.getAttribute("aria-valuenow").then(Number);
    const settled = () => page.waitForTimeout(650);
    const check = async (action, delta) => {
      const a = await angles();
      const f = await frequency();
      await action();
      await page.waitForTimeout(40);
      const b = await angles();
      assert.equal(b.length, a.length);
      b.forEach((v, i) =>
        assert.ok(
          Math.abs(v - a[i] - delta) < 0.0001,
          `${v - a[i]} != ${delta}`,
        ),
      );
      return (await frequency()) - f;
    };
    for (const step of [0.001, 0.01, 0.1, 1, 5, 10]) {
      await selectStep(page, String(step));
      await settled();
      assert.equal(
        await check(
          () =>
            page
              .getByRole("button", { name: "Шаг частоты вверх", exact: true })
              .click(),
          6,
        ),
        step * 1000,
      );
      assert.equal(
        await check(
          () =>
            page
              .getByRole("button", { name: "Шаг частоты вниз", exact: true })
              .click(),
          -6,
        ),
        -step * 1000,
      );
      await dial.scrollIntoViewIfNeeded();
      await dial.focus();
      const wheelBox = await dial.boundingBox();
      await page.mouse.move(
        wheelBox.x + wheelBox.width / 2,
        wheelBox.y + wheelBox.height / 2,
      );
      assert.equal(
        await check(() => page.mouse.wheel(0, -100), 6),
        step * 1000,
      );
      assert.equal(
        await check(() => page.mouse.wheel(0, 100), -6),
        -step * 1000,
      );
      await check(() => dial.press("PageUp"), 60);
      await check(() => dial.press("PageDown"), -60);
    }
    // External changes arrive through the same props as receiver/preset updates.
    await selectStep(page, "10");
    const previous = await frequency();
    await check(
      async () => {
        await page.locator("#frequency").fill("7200");
        await page
          .getByRole("button", { name: "Настроить", exact: true })
          .click();
      },
      ((7200000 - previous) / 10000) * 6,
    );
    const beforeBand = await frequency();
    const beforeBandAngles = await angles();
    await page.locator(".band-selector button").last().click();
    await page.waitForTimeout(40);
    const bandFrequency = await frequency();
    assert.notEqual(bandFrequency, beforeBand);
    (await angles()).forEach((v, i) =>
      assert.ok(
        Math.abs(
          v - beforeBandAngles[i] - ((bandFrequency - beforeBand) / 10000) * 6,
        ) < 0.0001,
      ),
    );
    // Long accumulated rotation never normalizes to 0 at a whole revolution.
    await selectStep(page, "0.001");
    await dial.scrollIntoViewIfNeeded();
    await dial.focus();
    const origin = await angles();
    for (let i = 0; i < 80; i++) await dial.press("ArrowUp");
    await page.waitForTimeout(40);
    (await angles()).forEach((v, i) =>
      assert.ok(Math.abs(v - origin[i] - 480) < 0.0001),
    );
    // Actual mouse and CDP finger drags, including touch scroll/capture.
    for (const touch of [false, true]) {
      await dial.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const box = await dial.boundingBox(),
        cx = box.x + box.width / 2,
        cy = box.y + box.height / 2,
        r = box.width * 0.35;
      const scroll = await page.evaluate(() => scrollY),
        f = await frequency();
      const cdp = touch ? await context.newCDPSession(page) : null;
      if (touch)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: cx + r, y: cy, id: 1 }],
        });
      else {
        await page.mouse.move(cx + r, cy);
        await page.mouse.down();
      }
      assert.equal(
        await dial.evaluate((e) => e.hasPointerCapture(window.__pointerId)),
        true,
      );
      for (const direction of [1, -1])
        for (let i = 1; i <= 24; i++) {
          const a = (direction * i * Math.PI) / 12,
            x = cx + r * Math.cos(a),
            y = cy + r * Math.sin(a);
          if (touch)
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x, y, id: 1 }],
            });
          else await page.mouse.move(x, y);
          await page.waitForTimeout(i % 2 ? 5 : 30);
        }
      if (touch) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await cdp.detach();
      } else await page.mouse.up();
      assert.ok(
        Math.abs((await frequency()) - f) <= 2,
        "both directions return within fractional tick carry",
      );
      assert.equal(
        await page.evaluate(() => scrollY),
        scroll,
        "finger must not scroll page",
      );
    }
    // Smoothing and inertia are visual; frequency changes before the angle settles.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await settled();
    await dial.scrollIntoViewIfNeeded();
    await dial.focus();
    const start = (await angles())[0],
      f = await frequency();
    const trace = await dial.evaluate(async (e) => {
      const values = [];
      e.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "PageUp",
          bubbles: true,
          cancelable: true,
        }),
      );
      const immediate = {
        angle: parseFloat(e.style.getPropertyValue("--vfo-angle")),
        frequency: +e.getAttribute("aria-valuenow"),
      };
      for (let i = 0; i < 45; i++) {
        await new Promise(requestAnimationFrame);
        values.push(parseFloat(e.style.getPropertyValue("--vfo-angle")));
      }
      return { immediate, values };
    });
    assert.equal(trace.immediate.frequency, f + 10);
    assert.equal(
      trace.immediate.angle,
      start,
      "tuning does not wait for animation",
    );
    assert.ok(trace.values.some((a) => a > start && a < start + 60));
    assert.ok(Math.abs(trace.values.at(-1) - start - 60) < 0.01);
    const style = await dial.evaluate((e) => ({
      face: getComputedStyle(e.querySelector(".vfo-face")).transform,
      rim: getComputedStyle(e, "::before").transform,
      body: getComputedStyle(e).transform,
      label: getComputedStyle(e.querySelector("span")).transform,
      touch: getComputedStyle(e).touchAction,
    }));
    assert.equal(style.face, style.rim);
    assert.equal(style.body, "none");
    assert.equal(style.label, "none");
    assert.equal(style.touch, "none");
    results.push({
      mobile,
      stepsHz: [1, 10, 100, 1000, 5000, 10000],
      accumulatedDegrees: 480,
      style,
      trace,
    });
    console.log("PASS VFO animation", mobile ? "mobile" : "desktop");
    await context.close();
  }
} finally {
  mkdirSync("artifacts/vfo-animation", { recursive: true });
  writeFileSync(
    "artifacts/vfo-animation/checks.json",
    JSON.stringify(results, null, 2),
  );
  await browser.close();
}
