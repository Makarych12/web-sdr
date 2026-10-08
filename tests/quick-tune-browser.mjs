import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } }),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__sockets = 0;
  const Native = WebSocket;
  window.WebSocket = class extends Native {
    constructor(...a) {
      super(...a);
      window.__sockets++;
    }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...a) {
    if (this instanceof GainNode && a[0] === this.context.destination) {
      window.__out = this.context.createAnalyser();
      connect.call(this, window.__out);
    }
    return connect.apply(this, a);
  };
});
const menu = page.getByRole("region", {
  name: "Быстрая настройка",
  exact: true,
});
async function healthy() {
  await page.waitForFunction(
    () => {
      const a = window.__out;
      if (!a || +document.querySelector(".fall canvas").dataset.rows < 12)
        return false;
      const pcm = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(pcm);
      return pcm.some((v) => Math.abs(v) > 1e-6);
    },
    {},
    { timeout: 45000 },
  );
}
try {
  await page.goto(process.env.TEST_QUICK_URL || "http://127.0.0.1:5173");
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await menu.locator("summary").click();
  await page
    .getByLabel("Частота для быстрой настройки", { exact: true })
    .fill("14,200125");
  await page.getByLabel("Единицы частоты", { exact: true }).selectOption("MHz");
  await page
    .getByLabel("Режим быстрой настройки", { exact: true })
    .selectOption("USB");
  await page.getByLabel("Название частоты", { exact: true }).fill("Мой эфир");
  await menu.getByRole("button", { name: "Добавить", exact: true }).click();
  assert.equal(await page.locator("#frequency").inputValue(), "10000");
  assert.equal(
    await menu
      .locator('[aria-label="Закреплённые частоты"] .quick-card')
      .count(),
    5,
  );
  await page.reload();
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await menu
    .getByRole("button", {
      name: "Настроить Мой эфир, 14200.125 кГц, USB",
      exact: true,
    })
    .click();
  assert.equal(await page.locator("#frequency").inputValue(), "14200.125");
  await page.locator(".connect").click();
  await healthy();
  const sockets = await page.evaluate(() => window.__sockets);
  await menu
    .locator('[aria-label="Недавние частоты"]')
    .getByRole("button", { name: /Настроить.*14200.125/ })
    .waitFor();
  checks.push(
    "manual MHz/comma/Hz-precision, persistence, real tuning and automatic recent entry",
  );
  await page.getByLabel("Полоса фильтра", { exact: true }).selectOption("1800");
  await menu
    .getByRole("button", { name: "☆ Сохранить текущую", exact: true })
    .click();
  assert.equal(
    await menu
      .locator('[aria-label="Закреплённые частоты"] .quick-card')
      .count(),
    5,
  );
  // Same frequency/mode updates the saved filter rather than creating a duplicate.
  await menu
    .locator('[aria-label="Закреплённые частоты"]')
    .getByRole("button", { name: /Настроить 40 м/ })
    .click();
  await healthy();
  await page.waitForFunction(
    () => +document.querySelector("#frequency").value === 7074,
  );
  await menu
    .locator('[aria-label="Закреплённые частоты"]')
    .getByRole("button", { name: /14200.125 кГц/ })
    .click();
  assert.equal(
    await page.getByLabel("Полоса фильтра", { exact: true }).inputValue(),
    "1800",
  );
  await healthy();
  assert.equal(await page.evaluate(() => window.__sockets), sockets);
  checks.push(
    "saved filter restored and actual audio/waterfall continue on the same sockets",
  );
  await menu.locator("summary").click();
  await page
    .getByLabel("Частота для быстрой настройки", { exact: true })
    .fill("31000");
  await menu.getByRole("button", { name: "Добавить", exact: true }).click();
  await menu.getByRole("alert").waitFor();
  assert.equal(await page.locator("#frequency").inputValue(), "14200.125");
  await menu
    .getByRole("button", {
      name: "Убрать из быстрой настройки Мой эфир",
      exact: true,
    })
    .click();
  checks.push("invalid input rejected; saved entry removable");
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 1800 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await menu.screenshot({ path: `artifacts/quick-tune-${width}.png` });
    checks.push(`viewport ${width}: no overflow`);
  }
  await menu
    .getByRole("button", { name: "Очистить историю", exact: true })
    .click();
  assert.equal(
    await menu.locator('[aria-label="Недавние частоты"] .quick-card').count(),
    0,
  );
  await page.locator(".connect").click();
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/quick-tune-report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log("PASS", checks);
} finally {
  await browser.close();
}
