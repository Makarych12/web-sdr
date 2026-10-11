import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { selectStep } from "./step-control.mjs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const reports = [];
mkdirSync("artifacts/callsign-step", { recursive: true });
try {
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 820, 1180],
    ["mobile", 390, 844],
    ["phone", 360, 800],
    ["small-mobile", 320, 740],
  ]) {
    const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: true,
        reducedMotion: "reduce",
      }),
      page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.TEST_APP_URL || "http://localhost:8788");
    await page.locator(".digital-frequency").waitFor();
    const dial = page.locator(".vfo-dial").first(),
      freq = () => dial.getAttribute("aria-valuenow").then(Number);
    const up = page.getByRole("button", {
        name: "Увеличить шаг настройки",
        exact: true,
      }),
      down = page.getByRole("button", {
        name: "Уменьшить шаг настройки",
        exact: true,
      });
    for (const button of [up, down]) {
      const box = await button.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
    }
    const originalFrequency = await freq();
    await selectStep(page, 0.001);
    await down.click({ force: true });
    assert.match(
      await page.getByLabel("Текущий шаг настройки").textContent(),
      /1 Hz/,
    );
    assert.equal(await freq(), originalFrequency);
    const checks = [];
    for (const step of [0.001, 0.01, 0.1, 1, 5, 10]) {
      await selectStep(page, step);
      assert.equal(await freq(), originalFrequency);
      const base = await freq();
      await page
        .getByRole("button", { name: "Шаг частоты вверх", exact: true })
        .click();
      assert.equal(await freq(), base + step * 1000);
      await page
        .getByRole("button", { name: "Шаг частоты вниз", exact: true })
        .click();
      assert.equal(await freq(), base);
      await dial.scrollIntoViewIfNeeded();
      await dial.focus();
      const b = await dial.boundingBox();
      await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(50);
      assert.equal(await freq(), base + step * 1000);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(50);
      assert.equal(await freq(), base);
      const x = b.x + b.width / 2,
        y = b.y + b.height / 2,
        r = b.width * 0.35;
      await page.mouse.move(x + r, y);
      await page.mouse.down();
      await page.mouse.move(x, y + r);
      await page.mouse.up();
      assert.ok(Math.abs((await freq()) - base - 15 * step * 1000) < 0.001);
      await page.mouse.move(x, y + r);
      await page.mouse.down();
      await page.mouse.move(x + r, y);
      await page.mouse.up();
      assert.equal(await freq(), base);
      checks.push({ stepHz: step * 1000, frequency: base });
    }
    await up.click({ force: true });
    assert.match(
      await page.getByLabel("Текущий шаг настройки").textContent(),
      /10 kHz/,
    );
    assert.equal(await freq(), originalFrequency);
    await down.scrollIntoViewIfNeeded();
    const box = await down.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    assert.match(
      await page.getByLabel("Текущий шаг настройки").textContent(),
      /5 kHz/,
    );
    await up.scrollIntoViewIfNeeded();
    const plus = await up.boundingBox();
    await page.touchscreen.tap(
      plus.x + plus.width / 2,
      plus.y + plus.height / 2,
    );
    assert.match(
      await page.getByLabel("Текущий шаг настройки").textContent(),
      /10 kHz/,
    );
    await down.focus();
    await down.press("ArrowLeft");
    await down.press("Enter");
    assert.match(
      await page.getByLabel("Текущий шаг настройки").textContent(),
      /1 kHz/,
    );
    await up.focus();
    await up.press(" ");
    assert.match(
      await page.getByLabel("Текущий шаг настройки").textContent(),
      /5 kHz/,
    );
    await page.reload();
    assert.match(
      await page.getByLabel("Текущий шаг настройки").textContent(),
      /5 kHz/,
    );
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("wave.step"))),
      5,
    );
    assert.equal(await page.locator(".steps select").count(), 0);
    assert.equal(await page.locator(".vfo-dial").count(), 2, "no new SDR/VFO");
    if (name === "desktop") {
      const field = page.getByLabel("Позывной для поиска");
      await field.fill("  dl1abc ");
      assert.equal(await field.inputValue(), "  DL1ABC ");
      await field.press("Enter");
      await page.locator(".callsign-result strong").waitFor({ timeout: 30000 });
      assert.equal(await field.inputValue(), "DL1ABC");
      assert.equal(
        await page.locator(".callsign-result strong").textContent(),
        "DL1ABC",
      );
      assert.ok(
        (await page.locator(".callsign-name").textContent()).trim().length > 0,
      );
      assert.equal(
        await page.locator(".callsign-result dd").first().textContent(),
        "Germany",
      );
      assert.equal(
        await page.locator(".callsign-flag").getAttribute("aria-label"),
        "Флаг: Germany",
      );
      assert.equal(await page.locator(".callsign-result iframe").count(), 0);
      assert.equal(
        await page
          .locator(".callsign-result")
          .getByText("От UR4MTN", { exact: true })
          .count(),
        0,
        "origin not known: no invented distance",
      );
      await page
        .locator(".callsign-search")
        .screenshot({ path: "artifacts/callsign-step/real-DL1ABC.png" });
      await field.fill("ZZ0ZZZZ");
      await field.press("Enter");
      await page
        .getByText("Позывной не найден в справочнике", { exact: true })
        .waitFor({ timeout: 30000 });
      await field.fill("UR4MTN");
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith("/api/callsign/UR4MTN")),
        field.press("Enter"),
      ]);
      await page
        .getByText("Позывной не найден в справочнике", { exact: true })
        .waitFor();
      await page.route("**/api/callsign/*", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            status: "unavailable",
            message: "Поиск временно недоступен. Попробуйте позже.",
          }),
        }),
      );
      await field.fill("W1AW");
      await field.press("Enter");
      await page.locator(".callsign-error").waitFor();
      assert.match(
        await page.locator(".callsign-error").textContent(),
        /временно недоступен/,
      );
      await page.unroute("**/api/callsign/*");
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "no horizontal overflow",
    );
    await page.screenshot({
      path: `artifacts/callsign-step/${name}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    reports.push({ name, width, checks, errors });
    console.log("PASS callsign/step", name);
    await context.close();
  }
} finally {
  writeFileSync(
    "artifacts/callsign-step/browser.json",
    JSON.stringify(reports, null, 2),
  );
  await browser.close();
}
