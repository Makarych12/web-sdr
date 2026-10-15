import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.TEST_APP_URL || "http://localhost:8787";
const dir = process.env.TEST_ARTIFACT_DIR || "artifacts/page-scroll";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const report = { url: base, cases: [], errors: [] };
try {
  for (const [width, height, dpr] of [
    [360, 800, 2],
    [390, 844, 3],
    [1440, 1000, 1],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: dpr,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    await page.goto(base + "/#listen");
    await page.waitForFunction(
      () => +document.querySelector(".receiver-choice")?.dataset.count > 0,
    );
    const input = page.locator("#frequency");
    await input.fill("7074.251");
    await input.press("Enter");
    await page.getByRole("button", { name: "USB", exact: true }).click();
    const main = page.locator(".tuner > .vfo-control .vfo-dial");
    assert.deepEqual(
      await main.evaluate((e) => ({
        width: e.getBoundingClientRect().width,
        height: e.getBoundingClientRect().height,
        offset: e.offsetWidth,
        transform: getComputedStyle(e).transform,
      })),
      { width: 164, height: 164, offset: 164, transform: "none" },
    );
    assert.equal(
      await page.locator(".fine-tune .vfo-dial").evaluate((e) => e.offsetWidth),
      86,
    );
    await page
      .locator(".tuner")
      .screenshot({ path: `${dir}/tuner-${width}x${height}.png` });
    await page.locator(".receiver .connect").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".header-right").textContent.includes("В эфире"),
      null,
      { timeout: 90000 },
    );
    const canvas = page.locator(".fall canvas");
    const state = () =>
      page
        .locator(".visual")
        .evaluate((e) => ({
          frequency: document.querySelector("#frequency").value,
          start: +e.dataset.start,
          span: +e.dataset.span,
          zoom: +e.dataset.zoom,
          cuts: document.querySelector(".filter-control small").textContent,
        }));
    async function ready() {
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(450);
      return canvas.boundingBox();
    }
    let b = await ready();
    await canvas.focus();
    let before = await state(),
      scroll = await page.evaluate(() => scrollY);
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.5);
    await page.mouse.wheel(0, 180);
    await page.waitForTimeout(500);
    assert.ok((await page.evaluate(() => scrollY)) > scroll + 30);
    assert.deepEqual(await state(), before);
    const cdp = await context.newCDPSession(page);
    for (const fraction of [0.2, 0.5]) {
      b = await ready();
      before = await state();
      scroll = await page.evaluate(() => scrollY);
      const x = b.x + b.width * fraction,
        y = b.y + b.height * 0.8;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      for (let i = 1; i <= 12; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + Math.sin(i) * 2, y: y - i * 10, id: 1 }],
        });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await page.waitForTimeout(900);
      assert.ok(
        (await page.evaluate(() => scrollY)) > scroll + 20,
        `${width}: vertical swipe did not scroll`,
      );
      assert.deepEqual(
        await state(),
        before,
        `${width}: swipe changed receiver`,
      );
      // A late pointerup from the cancelled drag cannot tune after scrolling.
      await canvas.dispatchEvent("pointerup", {
        pointerId: 1,
        pointerType: "touch",
        clientX: x,
        clientY: y - 120,
        bubbles: true,
      });
      assert.deepEqual(await state(), before);
    }
    b = await ready();
    before = await state();
    scroll = await page.evaluate(() => scrollY);
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.5);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);
    let after = await state();
    assert.equal(after.frequency, before.frequency);
    assert.equal(after.zoom, before.zoom + 1);
    assert.equal(await page.evaluate(() => scrollY), scroll);
    for (const vertical of [false, true]) {
      b = await ready();
      before = await state();
      scroll = await page.evaluate(() => scrollY);
      const x = b.x + b.width * 0.5,
        y = b.y + b.height * 0.5;
      const pts = (distance) =>
        vertical
          ? [
              { x, y: y - distance, id: 1 },
              { x, y: y + distance, id: 2 },
            ]
          : [
              { x: x - distance, y, id: 1 },
              { x: x + distance, y, id: 2 },
            ];
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: pts(20),
      });
      for (let i = 1; i <= 8; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: pts(20 + i * 4),
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await page.waitForTimeout(500);
      after = await state();
      assert.equal(
        after.zoom,
        before.zoom + 1,
        `${width}: ${vertical ? "vertical" : "horizontal"} pinch`,
      );
      assert.equal(after.frequency, before.frequency);
      assert.equal(await page.evaluate(() => scrollY), scroll);
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await cdp.detach();
    await page.locator(".receiver .connect").click();
    report.cases.push({
      width,
      height,
      dpr,
      mainDiameter: 164,
      fineDiameter: 86,
      wheelScroll: true,
      swipeScroll: true,
      noAccidentalTune: true,
      ctrlWheelZoom: true,
      pinchBothDirections: true,
    });
    await context.close();
    console.log(
      `PASS ${width}x${height} DPR${dpr}: full-size VFO, native scroll, Ctrl wheel and pinch`,
    );
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
