import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.TEST_HLS_URL || "http://127.0.0.1:8792";
const seconds = Number(process.env.TEST_HLS_SECONDS || 65);
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const requests = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname.startsWith("/api/hls"))
    requests.push({
      at: Date.now(),
      path: url.pathname,
      generation: url.searchParams.get("generation"),
      sequence: url.searchParams.get("sequence"),
    });
});
await page.addInitScript(() => {
  window.AudioContext = class {
    constructor() {
      throw Error("Unexpected WebAudio");
    }
  };
  window.WebSocket = class {
    constructor() {
      throw Error("Unexpected renderer WebSocket");
    }
  };
});
const id = randomUUID();
const url = new URL("/api/hls", base);
url.search = new URLSearchParams({
  session: id,
  receiver: "niendorf",
  frequency: "14200",
  mode: "USB",
  lowCut: "300",
  highCut: "2700",
  agc: "slow",
});
const snapshot = () =>
  page.locator("audio").evaluate((audio) => ({
    time: audio.currentTime,
    paused: audio.paused,
    ready: audio.readyState,
    error: audio.error?.message,
    decoded: audio.webkitAudioDecodedByteCount,
  }));
const cdp = await page.context().newCDPSession(page);
try {
  await page.goto(new URL("/audio-check.html", base).href);
  await page.evaluate((src) => {
    document.querySelector("#start").onclick = () => {
      const audio = document.querySelector("audio");
      audio.src = src;
      void audio.play();
    };
  }, url.href);
  await page.getByRole("button", { name: "Включить звук" }).click();
  await page.waitForFunction(
    () => {
      const a = document.querySelector("audio");
      return !a.paused && a.readyState >= 3 && a.currentTime > 1;
    },
    {},
    { timeout: 50000 },
  );
  const before = await snapshot(),
    at = Date.now();
  console.log("PASS real native HLS startup", before);
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  for (let elapsed = 0; elapsed < seconds; elapsed += 20) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(20, seconds - elapsed) * 1000),
    );
    console.log(
      "SCRIPTS DISABLED",
      Math.min(elapsed + 20, seconds),
      "seconds",
      requests.filter((r) => r.at >= at && r.path.includes("segment")).length,
      "segment requests",
    );
  }
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
  const after = await snapshot();
  assert.equal(after.error, undefined);
  assert.equal(after.paused, false);
  assert.ok(
    after.time - before.time > seconds - 2,
    "media clock must advance while page JavaScript is disabled",
  );
  assert.ok(
    requests.filter((r) => r.at >= at && r.path.includes("segment")).length > 5,
  );
  const generations = [
    ...new Set(requests.map((r) => r.generation).filter(Boolean)),
  ];
  if (process.env.TEST_HLS_ROTATIONS === "1")
    assert.ok(
      generations.length >= 2,
      "must survive a producer invocation ending",
    );
  assert.deepEqual(errors, []);
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/hls-browser-report.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        base,
        seconds,
        scenario:
          "native HLS with renderer JavaScript disabled; not a physical phone lock test",
        before,
        after,
        generations,
        requests,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("PASS native HLS without page JavaScript", {
    seconds,
    before,
    after,
    generations: generations.length,
  });
} catch (error) {
  console.log("HLS FAILURE", await snapshot(), { requests: requests.length });
  throw error;
} finally {
  await cdp
    .send("Emulation.setScriptExecutionDisabled", { value: false })
    .catch(() => {});
  await page.request
    .get(new URL(`/api/hls/stop?session=${id}`, base).href)
    .catch(() => {});
  await browser.close();
}
