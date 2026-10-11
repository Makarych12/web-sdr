import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const dir = "artifacts/callsign-fix";
mkdirSync(dir, { recursive: true });
const results = [];
try {
  for (const width of [1440, 820, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const geometry = [];
    for (const [phase, url] of [
      ["before", "https://web-sdr.vercel.app"],
      ["after", process.env.TEST_APP_URL || "http://localhost:8787"],
    ]) {
      await page.goto(url);
      await page
        .waitForFunction(
          () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
        )
        .catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      geometry.push(
        await page.evaluate(() =>
          Object.fromEntries(
            [
              ".frequency",
              ".digital-frequency",
              ".vfo-control",
              ".steps",
              ".tuner",
              ".visual",
              ".fine-tune",
              ".band-selector",
              ".bottom",
              "#favorites",
              "#about",
            ].map((s) => {
              const b = document.querySelector(s).getBoundingClientRect();
              return [s, { x: b.x, y: b.y, width: b.width, height: b.height }];
            }),
          ),
        ),
      );
      await page.screenshot({
        path: `${dir}/${phase}-${width}.png`,
        fullPage: true,
      });
    }
    assert.deepEqual(
      geometry[0],
      geometry[1],
      `unchanged geometry at ${width}`,
    );
    await page
      .getByLabel("Позывной для поиска", { exact: true })
      .fill(" ur4mad ");
    await page
      .getByLabel("Позывной для поиска", { exact: true })
      .press("Enter");
    await page.locator("#callsign-popover").waitFor({ state: "visible" });
    await page
      .getByText("Сервис поиска временно недоступен.", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByLabel("Позывной для поиска", { exact: true })
        .inputValue(),
      "UR4MAD",
    );
    const positions = await page.evaluate(() => {
      const p = document
          .querySelector("#callsign-popover")
          .getBoundingClientRect(),
        t = document.querySelector(".tuner").getBoundingClientRect();
      return {
        left: p.left,
        right: p.right,
        top: p.top,
        bottom: p.bottom,
        tunerBottom: t.bottom,
        viewport: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(positions.left >= 0 && positions.right <= width);
    assert.ok(positions.top >= positions.tunerBottom);
    assert.equal(positions.overflow, false);
    await page.screenshot({
      path: `${dir}/popover-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.locator("#callsign-popover").waitFor({ state: "hidden" });
    await page.getByLabel("Поиск позывного", { exact: true }).click();
    await page.locator("#callsign-popover").waitFor({ state: "visible" });
    await page.mouse.click(width - 5, 5);
    await page.locator("#callsign-popover").waitFor({ state: "hidden" });
    // UI fixtures verify rendering only; they are not live lookup evidence.
    await page.route("**/api/callsign/H1TEST", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "found",
          source: "HamQTH",
          callsign: "H1TEST",
          name: "Test Operator",
          country: "Japan",
          countryCode: "JP",
        }),
      });
    });
    await page
      .getByLabel("Позывной для поиска", { exact: true })
      .fill("H1TEST");
    const button = await page
      .getByLabel("Поиск позывного", { exact: true })
      .boundingBox();
    await page.touchscreen.tap(
      button.x + button.width / 2,
      button.y + button.height / 2,
    );
    await page.getByText("Ищем позывной…", { exact: true }).waitFor();
    await page.locator(".callsign-result strong").waitFor();
    assert.equal(
      await page.locator(".callsign-result strong").textContent(),
      "H1TEST",
    );
    assert.equal(
      await page.locator(".callsign-name").textContent(),
      "Test Operator",
    );
    assert.equal(
      await page.locator(".callsign-source a").first().textContent(),
      "HamQTH.com",
    );
    assert.equal(
      await page
        .locator(".callsign-result")
        .getByText("Locator", { exact: true })
        .count(),
      0,
    );
    await page.keyboard.press("Escape");
    await page.unroute("**/api/callsign/H1TEST");
    assert.deepEqual(errors, []);
    results.push({
      width,
      geometryUnchanged: true,
      positions,
      escape: true,
      outside: true,
    });
    await context.close();
  }
  writeFileSync(`${dir}/layout.json`, JSON.stringify(results, null, 2));
  console.log(results);
} finally {
  await browser.close();
}
