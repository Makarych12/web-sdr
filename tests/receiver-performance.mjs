import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = { cpuSlowdown: Number(process.env.TEST_CPU_RATE || 1) };
try {
  await page.goto(
    (process.env.TEST_APP_URL || "https://web-sdr.vercel.app") +
      "/?debug#listen",
  );
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 0,
  );
  await page.locator(".receiver .connect").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".header-right").textContent.includes("В эфире"),
    null,
    { timeout: 60000 },
  );
  await page.locator(".visual").scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: report.cpuSlowdown });
  report.raf = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const start = performance.now();
        let frames = 0,
          maxInterval = 0,
          previous = start;
        function tick(now) {
          frames++;
          maxInterval = Math.max(maxInterval, now - previous);
          previous = now;
          if (now - start < 5000) requestAnimationFrame(tick);
          else
            resolve({
              fps: (frames * 1000) / (now - start),
              maxIntervalMs: maxInterval,
            });
        }
        requestAnimationFrame(tick);
      }),
  );
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  report.beforeStall = await page.locator("footer").textContent();
  // A delivery interruption in the UI thread, not an invented remote-network measurement.
  await page.evaluate(() => {
    const end = performance.now() + 250;
    while (performance.now() < end) {}
  });
  await page.waitForTimeout(5000);
  report.afterStall = await page.locator("footer").textContent();
  report.status = await page.locator(".header-right").textContent();
} finally {
  await browser.close();
  writeFileSync(
    "artifacts/receiver-performance.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
}
