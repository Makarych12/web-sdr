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
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
    ["small-mobile", 320, 740],
    ["tablet", 820, 1180],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("http://localhost:8787");
    await page
      .locator("#receiver option")
      .nth(2)
      .waitFor({ state: "attached" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      name + " overflow",
    );
    await page.screenshot({ path: `artifacts/ur4mtn-${name}-home.png` });
    await page.getByRole("link", { name: "Слушать", exact: true }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `artifacts/ur4mtn-${name}-studio.png` });
    await page.getByRole("button", { name: "Серверы", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Закрыть список серверов" }).click();
    await page.getByRole("link", { name: "Избранное", exact: true }).click();
    await page.waitForTimeout(700);
    assert.ok(await page.locator("#favorites").isVisible());
    assert.equal(
      await page
        .getByRole("link", { name: "Избранное", exact: true })
        .getAttribute("aria-current"),
      "location",
    );
    await page.getByRole("link", { name: "О проекте", exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal(
      await page
        .getByRole("link", { name: "О проекте", exact: true })
        .getAttribute("aria-current"),
      "location",
    );
    console.log("PASS layout/navigation", name, width);
  }
} finally {
  await browser.close();
}
