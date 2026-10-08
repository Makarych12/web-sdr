import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
mkdirSync("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  async function settledScroll() {
    await page.waitForFunction(() => {
      const now = performance.now();
      const previous = window.__scrollSettled;
      if (!previous || previous.y !== scrollY) {
        window.__scrollSettled = { y: scrollY, at: now };
        return false;
      }
      return now - previous.at > 200;
    });
  }

  if (!process.env.TEST_ALLOW_UNCONFIGURED) {
    let failures = 0;
    await page.route("**/api/receivers", (route) => {
      if (failures++ === 0)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"Temporary failure"}',
        });
      return route.continue();
    });
    await page.goto(process.env.TEST_APP_URL || "http://localhost:8787");
    await page
      .getByRole("alert")
      .filter({ hasText: "Повторяем подключение" })
      .waitFor();
    await page.waitForFunction(
      () => +document.querySelector(".receiver-choice")?.dataset.count > 2,
    );
    await page.getByRole("alert").waitFor({ state: "hidden" });
    await page.unroute("**/api/receivers");
    console.log(
      "PASS catalog recovers from temporary HTTP failure without reload",
    );
  }
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
    ["small-mobile", 320, 740],
    ["tablet", 820, 1180],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(process.env.TEST_APP_URL || "http://localhost:8787");
    if (!process.env.TEST_ALLOW_UNCONFIGURED)
      await page.waitForFunction(
        () => +document.querySelector(".receiver-choice")?.dataset.count > 2,
      );
    else {
      await page.locator(".digital-frequency").waitFor();
      assert.ok(await page.locator(".hero-cta").isDisabled());
      await page
        .getByRole("alert")
        .filter({ hasText: "ещё не подключил шлюз" })
        .waitFor();
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      name + " overflow",
    );
    await page.waitForTimeout(600);
    assert.ok(
      (await page.locator(".digital-frequency").boundingBox()).y < height,
      name + " frequency visible without scrolling",
    );
    await page.screenshot({ path: `artifacts/ur4mtn-${name}-home.png` });
    await page.getByRole("link", { name: "Слушать", exact: true }).click();
    await settledScroll();
    await page.screenshot({ path: `artifacts/ur4mtn-${name}-studio.png` });
    await page.getByRole("button", { name: "Серверы", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Закрыть список серверов" }).click();
    await page.getByRole("link", { name: "Избранное", exact: true }).click();
    await settledScroll();
    assert.ok(await page.locator("#favorites").isVisible());
    assert.equal(
      await page
        .getByRole("link", { name: "Избранное", exact: true })
        .getAttribute("aria-current"),
      "location",
    );
    await page.getByRole("link", { name: "О проекте", exact: true }).click();
    await settledScroll();
    await page.waitForFunction(
      () =>
        document
          .querySelector('nav a[href="#about"]')
          ?.getAttribute("aria-current") === "location",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "О проекте", exact: true })
        .getAttribute("aria-current"),
      "location",
    );
    console.log("PASS layout/navigation", name, width);
  }
} catch (error) {
  for (const page of browser.contexts().flatMap((c) => c.pages())) {
    console.error(
      await page.evaluate(() => ({
        hash: location.hash,
        scrollY,
        height: innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        header: document.querySelector("header")?.getBoundingClientRect()
          .height,
        about: document
          .querySelector("#about")
          ?.getBoundingClientRect()
          .toJSON(),
        active: document.querySelector("nav [aria-current]")?.textContent,
      })),
    );
    await page.screenshot({ path: "artifacts/ui-failure.png", fullPage: true });
  }
  throw error;
} finally {
  await browser.close();
}
