import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  hasTouch: true,
});
const p = await context.newPage();
const results = [],
  errors = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await p.goto(
    (process.env.TEST_APP_URL || "http://localhost:5173") + "/?debug#listen",
  );
  await p.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 0,
  );
  const freq = p.locator("#frequency");
  for (const [text, expected] of [
    ["7074", "7074"],
    ["7074.25", "7074.25"],
    ["7.074 MHz", "7074"],
    ["7074250 Hz", "7074.25"],
  ]) {
    await freq.fill(text);
    await freq.press("Enter");
    assert.equal(await freq.inputValue(), expected);
  }
  await p.getByRole("button", { name: "USB", exact: true }).click();
  assert.match(await p.locator(".step-value").textContent(), /10 Hz/);
  await freq.press("ArrowRight");
  assert.equal(await freq.inputValue(), "7074.26");
  await freq.press("PageDown");
  assert.equal(await freq.inputValue(), "7074.16");
  assert.match(
    await p.locator(".filter-control small").textContent(),
    /300…2700/,
  );
  await p.getByRole("button", { name: "LSB", exact: true }).click();
  assert.match(
    await p.locator(".filter-control small").textContent(),
    /-2700…-300/,
  );
  await p.getByRole("button", { name: "Wide", exact: true }).click();
  assert.match(
    await p.locator(".filter-control small").textContent(),
    /-3000…-100/,
  );
  await p.getByRole("button", { name: "CW", exact: true }).click();
  await freq.press("ArrowRight");
  assert.equal(await freq.inputValue(), "7074.161");
  await p.getByRole("button", { name: "USB", exact: true }).click();
  await p.getByRole("button", { name: "▶ Слушать эфир", exact: true }).click();
  await p.waitForFunction(
    () =>
      document.querySelector(".header-right").textContent.includes("В эфире"),
    null,
    { timeout: 60000 },
  );
  results.push("unit input, 10 Hz SSB, 1 Hz CW, mirrored sideband presets");
  await p.locator(".visual").scrollIntoViewIfNeeded();
  const canvas = p.locator(".scope canvas");
  await canvas.scrollIntoViewIfNeeded();
  const before = await p.locator(".fall canvas").getAttribute("data-rows");
  const b = await canvas.boundingBox();
  await p.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.5);
  await p.keyboard.down("Control");
  await p.mouse.wheel(0, -100);
  await p.keyboard.up("Control");
  await p.waitForTimeout(500);
  assert.ok(
    +(await p.locator(".fall canvas").getAttribute("data-rows")) >= +before,
  );
  results.push("zoom preserves history");
  for (let i = 0; i < 4; i++)
    await p
      .getByRole("button", { name: "Увеличить масштаб", exact: true })
      .click();
  await p.waitForTimeout(1000);
  // Drag the left filter edge on the spectrum.
  const band = await p.locator(".scope .passband").boundingBox();
  if (band && band.width > 24) {
    const old = await p.locator(".filter-control small").textContent();
    await p.mouse.move(band.x, band.y + band.height / 2);
    await p.mouse.down();
    await p.mouse.move(band.x + 12, band.y + band.height / 2, { steps: 8 });
    await p.mouse.up();
    assert.notEqual(
      await p.locator(".filter-control small").textContent(),
      old,
    );
    results.push("filter edge drag");
  }
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [844, 390],
  ]) {
    await p.setViewportSize({ width, height });
    await p.locator(".visual").scrollIntoViewIfNeeded();
    await p.screenshot({ path: `artifacts/controls-${width}x${height}.png` });
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.equal(await p.locator(".callsign-search").count(), 0);
    assert.equal(await p.locator(".frequency .frequency-nudges button").count(), 6);
    const meter = await p.locator(".smeter-track").boundingBox();
    assert.ok(meter.width > 150);
  }
  results.push("360x800, 390x844, 844x390 no horizontal overflow");
  await p.getByRole("button", { name: "■ Отключиться", exact: true }).click();
  const saved = await freq.inputValue();
  await p.reload();
  assert.equal(await freq.inputValue(), saved);
  assert.ok(
    await p
      .getByRole("button", { name: "▶ Слушать эфир", exact: true })
      .isVisible(),
  );
  results.push("frequency restore without autoplay");
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(
    "artifacts/receiver-controls.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
  console.log(results, errors);
}
