import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { selectStep } from "./step-control.mjs";
const base = process.env.TEST_APP_URL || "http://localhost:5173";
const output = process.env.TEST_REPORT || "artifacts/dials-live.json";
mkdirSync("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const report = {
  url: base,
  receiver: "Niendorf direct KiwiSDR",
  widths: [],
  errors: [],
};
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    await page.addInitScript(() => {
      window.__dialLive = { commands: [], sockets: [], contexts: 0 };
      const W = WebSocket;
      window.WebSocket = class extends W {
        constructor(...args) {
          super(...args);
          window.__dialLive.sockets.push(this);
        }
        send(value) {
          if (typeof value === "string" && value.startsWith("SET mod="))
            window.__dialLive.commands.push(value);
          super.send(value);
        }
      };
      const A = AudioContext;
      window.AudioContext = class extends A {
        constructor(...args) {
          super(...args);
          window.__dialLive.contexts++;
        }
      };
    });
    await page.goto(base + "/#listen");
    await page.waitForFunction(
      () => +document.querySelector(".receiver-choice")?.dataset.count > 0,
    );
    const input = page.locator("#frequency");
    await input.fill("7074.251");
    await input.press("Enter");
    await page.getByRole("button", { name: "USB", exact: true }).click();
    await page.locator(".receiver .connect").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".header-right").textContent.includes("В эфире"),
      null,
      { timeout: 90000 },
    );
    const checks = [];
    async function check(hz) {
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
      const commands = await page.evaluate(() => window.__dialLive.commands);
      const last = commands.at(-1);
      const freq = last.match(/ freq=(\d+)\.(\d{3})$/);
      assert.equal(Number(freq[1]) * 1000 + Number(freq[2]), hz, last);
      assert.match(last, /mod=usb low_cut=300 high_cut=2700/);
      const view = await page.locator(".visual").evaluate((e) => ({
        start: +e.dataset.start,
        span: +e.dataset.span,
        left: parseFloat(e.querySelector(".scope .marker").style.left),
      }));
      assert.ok(
        Math.abs(view.left - ((hz / 1000 - view.start) / view.span) * 100) <
          0.001,
      );
    }
    for (const step of [1, 10, 100, 1000]) {
      await selectStep(page, String(step / 1000));
      for (let index = 0; index < 2; index++) {
        const dial = page.locator(".vfo-dial").nth(index);
        let hz = Number(await dial.getAttribute("aria-valuenow"));
        await dial.press("ArrowUp");
        hz += step;
        await check(hz);
        await dial.scrollIntoViewIfNeeded();
        await dial.focus();
        const b = await dial.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.wheel(0, 100);
        await page.waitForFunction(
          (hz) =>
            +document
              .querySelector(".vfo-dial")
              .getAttribute("aria-valuenow") === hz,
          hz - step,
        );
        hz -= step;
        await check(hz);
        checks.push({
          dial: index,
          stepHz: step,
          command: await page.evaluate(() => window.__dialLive.commands.at(-1)),
        });
      }
    }
    const resources = await page.evaluate(() => ({
      contexts: window.__dialLive.contexts,
      sockets: window.__dialLive.sockets
        .filter((s) => s.readyState === 1 && !s.url.includes("?token="))
        .map((s) => s.url),
    }));
    assert.equal(resources.contexts, 1);
    assert.equal(resources.sockets.length, 2);
    assert.ok(
      resources.sockets.every((url) =>
        url.startsWith("wss://kwsdr.db0nas.de/"),
      ),
    );
    report.widths.push({
      width,
      checks,
      resources,
      meter: await page.locator(".smeter-top strong").textContent(),
    });
    await page.locator(".receiver .connect").click();
    await context.close();
    console.log(
      `PASS real Kiwi ${width}px: both dials, exact Hz and raw Kiwi commands`,
    );
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(output, JSON.stringify(report, null, 2));
  await browser.close();
}
