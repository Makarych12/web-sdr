import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.AudioContext = class {
      constructor() {
        throw new Error("Unexpected AudioContext");
      }
    };
    window.WebSocket = class {
      constructor() {
        throw new Error("Unexpected client WebSocket");
      }
    };
  });
  await page.goto(
    new URL(
      "/audio-check.html?receiver=niendorf&frequency=14200&mode=USB",
      process.env.TEST_NATIVE_URL || "http://127.0.0.1:8790",
    ).href,
  );
  await page.getByRole("button", { name: "Включить звук" }).click();
  await page.waitForFunction(
    () => {
      const a = document.querySelector("audio");
      return (
        !a.paused &&
        a.readyState >= 3 &&
        a.currentTime > 3 &&
        a.webkitAudioDecodedByteCount > 0
      );
    },
    {},
    { timeout: 45000 },
  );
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS standalone real Kiwi audio, user-gesture playback, no AudioContext/client WebSocket, 320/390/820 layouts",
  );
} finally {
  await browser.close();
}
