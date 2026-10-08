import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Xiaomi 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 DuckDuckGo/5",
});
const page = await context.newPage(),
  requests = [],
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (new URL(r.url()).pathname === "/api/audio")
    requests.push({ at: Date.now(), url: r.url() });
});
await page.addInitScript(() => {
  const Context = AudioContext;
  window.AudioContext = class extends Context {
    constructor(...args) {
      super(...args);
      window.__context = this;
    }
  };
  const Worklet = AudioWorkletNode;
  window.AudioWorkletNode = class extends Worklet {
    constructor(...args) {
      super(...args);
      const post = this.port.postMessage.bind(this.port);
      this.port.postMessage = (data, ...rest) => {
        if (!window.__suspendPCM || !data.samples) post(data, ...rest);
      };
    }
  };
  window.__ticks = 0;
  setInterval(() => window.__ticks++, 50);
  window.__handlers = {};
  if (navigator.mediaSession) {
    const set = navigator.mediaSession.setActionHandler.bind(
      navigator.mediaSession,
    );
    navigator.mediaSession.setActionHandler = (name, fn) => {
      window.__handlers[name] = fn;
      return set(name, fn);
    };
  }
});
const snapshot = () =>
  page.evaluate(() => {
    const a = document.querySelector(".native-radio-output"),
      local = document.querySelector("audio");
    return {
      ticks: window.__ticks,
      time: a.currentTime,
      decoded: a.webkitAudioDecodedByteCount,
      paused: a.paused,
      ready: a.readyState,
      error: a.error?.message,
      src: a.src,
      sourceFrequency: a.dataset.frequency,
      sourceMode: a.dataset.mode,
      localMuted: local.muted,
      frequency: document.querySelector("#frequency").value,
      mode: document.querySelector(".modes .selected").textContent,
      rows: +document.querySelector(".fall canvas").dataset.rows,
    };
  });
async function healthy() {
  await page.waitForFunction(
    () => {
      const a = document.querySelector(".native-radio-output");
      const url = a?.src ? new URL(a.src) : null;
      return (
        a?.dataset.frequency === document.querySelector("#frequency").value &&
        a?.dataset.mode ===
          document.querySelector(".modes .selected").textContent &&
        a?.dataset.agc === document.querySelector("#agc").value &&
        a &&
        !a.paused &&
        a.readyState >= 3 &&
        a.currentTime > 0.2 &&
        document.querySelector(".header-right").textContent.includes("ONLINE")
      );
    },
    {},
    { timeout: 45000 },
  );
}
function pass(label, detail) {
  checks.push({ label, detail });
  console.log("PASS", label, detail ?? "");
}
try {
  await page.goto(
    process.env.TEST_NATIVE_URL || "http://127.0.0.1:8790/#listen",
  );
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await page
    .locator(".band-selector button")
    .filter({ hasText: /^20m/ })
    .click();
  await page.locator(".connect").click();
  await healthy();
  const initial = await snapshot();
  assert.ok(initial.src.includes("/api/audio"));
  assert.ok(initial.localMuted);
  assert.ok(initial.decoded > 0);
  pass("Android/DuckDuckGo UA selects real HTTP media output", initial);
  for (const band of ["40", "20"]) {
    await page
      .locator(".band-selector button")
      .filter({ hasText: new RegExp(`^${band}m`) })
      .click();
    await healthy();
    assert.equal(
      (await snapshot()).sourceFrequency,
      band === "40" ? "7100" : "14200",
    );
  }
  for (const mode of ["AM", "LSB", "CW", "FM", "USB"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await healthy();
    assert.equal((await snapshot()).sourceMode, mode);
  }
  await page.getByLabel("Полоса фильтра", { exact: true }).selectOption("1800");
  await page.getByLabel("AGC", { exact: true }).selectOption("fast");
  await healthy();
  assert.equal((await snapshot()).src, initial.src);
  assert.equal(requests.length, 1);
  const source = (await snapshot()).src;
  assert.equal(
    await page.locator(".native-radio-output").getAttribute("data-high-cut"),
    "2100",
  );
  assert.equal(
    await page.locator(".native-radio-output").getAttribute("data-agc"),
    "fast",
  );
  pass("native source follows bands/modes/filter/AGC");
  await page
    .locator(".fine-tune")
    .getByRole("button", { name: "Zoom +", exact: true })
    .click();
  await page.waitForTimeout(400);
  assert.equal((await snapshot()).src, source);
  pass("panorama zoom retains native media URL");
  await page.evaluate(() => {
    const audio = document.querySelector(".native-radio-output");
    const play = audio.play.bind(audio);
    let once = true;
    audio.play = () => {
      if (once) {
        once = false;
        return Promise.reject(new DOMException("interrupted", "AbortError"));
      }
      return play();
    };
  });
  await page
    .locator(".fine-tune")
    .getByRole("button", { name: "Точная подстройка: частота плюс шаг" })
    .click();
  await page.waitForTimeout(1500);
  assert.equal((await snapshot()).src, source);
  assert.equal(
    await page
      .locator("audio")
      .first()
      .evaluate((a) => a.muted),
    true,
  );
  pass("transient AbortError does not switch native audio back to PCM");
  const before = await snapshot(),
    at = Date.now();
  await page.evaluate(async () => {
    window.__suspendPCM = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    if (window.__context.state !== "running")
      throw new Error("App suspended AudioContext when hidden");
    await window.__context.suspend();
  });
  const seconds = Number(process.env.TEST_NATIVE_SECONDS || 120);
  for (let elapsed = 0; elapsed < seconds; elapsed += 30) {
    await new Promise((r) =>
      setTimeout(r, Math.min(30, seconds - elapsed) * 1000),
    );
    console.log(
      "BACKGROUND",
      Math.min(elapsed + 30, seconds),
      "seconds; media requests",
      requests.filter((r) => r.at >= at).length,
    );
  }

  const after = await snapshot();
  await page.locator(".audio-diagnostics summary").click();
  await page
    .getByRole("button", { name: "Скопировать диагностику звука" })
    .click();
  const report = JSON.parse(
    await page
      .getByRole("textbox", { name: "Журнал фонового звука" })
      .inputValue(),
  );
  assert.ok(
    report.events.some(
      (e) =>
        e.event === "page:visibility" &&
        e.state.hidden &&
        e.state.output === "http-mp3",
    ),
  );
  assert.ok(
    report.events.some(
      (e) => e.event === "native:play-error" && e.state.name === "AbortError",
    ),
  );
  assert.ok(!JSON.stringify(report).includes("session="));
  pass(
    "local diagnostic report records selected route and interruptions without stream tokens",
  );
  assert.equal(await page.evaluate(() => window.__context.state), "suspended");
  assert.equal(after.paused, false);
  assert.ok(after.time > 0);
  assert.equal(after.error, undefined);
  assert.ok(
    after.time - before.time > seconds - 8,
    "native media clock did not advance independently of suspended AudioContext",
  );
  pass(
    "native playback continues with suspended AudioContext and suppressed PCM delivery",
    {
      seconds,
      tickDelta: after.ticks - before.ticks,
      before,
      after,
      requestsWhileBackground: requests.filter((r) => r.at >= at),
    },
  );
  await page.evaluate(() => {
    window.__suspendPCM = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("resume"));
  });
  await healthy();
  await page.waitForFunction(
    (rows) => +document.querySelector(".fall canvas").dataset.rows > rows,
    after.rows,
    { timeout: 45000 },
  );
  pass("real waterfall and foreground receiver recover after background");
  await page.evaluate(() => window.__handlers.pause());
  await page.waitForFunction(
    () => document.querySelector(".native-radio-output").paused,
  );
  await page.evaluate(() => window.__handlers.play());
  await healthy();
  pass("Media Session controls both outputs");
  const oldSession = new URL((await snapshot()).src).searchParams.get(
    "session",
  );
  await page.route(
    "**/api/audio/tune?**",
    (route) => route.fulfill({ status: 404, body: "session lost" }),
    { times: 1 },
  );
  await page
    .locator(".band-selector button")
    .filter({ hasText: /^40m/ })
    .click();
  await healthy();
  assert.notEqual(
    new URL((await snapshot()).src).searchParams.get("session"),
    oldSession,
  );
  assert.equal(
    new URL((await snapshot()).src).searchParams.get("frequency"),
    "7100",
  );
  pass("lost server session reconnects with a new token and current frequency");
  await page
    .getByRole("checkbox", { name: "Фоновый эфир", exact: true })
    .uncheck();
  await page.waitForFunction(
    () =>
      !document.querySelector(".native-radio-output").getAttribute("src") &&
      !document.querySelector("audio").muted,
  );
  await page
    .getByRole("checkbox", { name: "Фоновый эфир", exact: true })
    .check();
  await healthy();
  pass("background switch restores original PCM or native output");
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page
      .locator(".background-audio")
      .screenshot({ path: `artifacts/native-background-${width}.png` });
  }
  pass("320/390/820 without overflow");
  await page.locator(".connect").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".native-radio-output").paused &&
      !document.querySelector(".native-radio-output").getAttribute("src"),
  );
  pass("explicit stop releases native stream");
  const fallback = await context.newPage();
  await fallback.route("**/api/audio?**", (route) =>
    route.fulfill({ status: 403, body: "unavailable" }),
  );
  await fallback.goto(
    process.env.TEST_NATIVE_URL || "http://127.0.0.1:8790/#listen",
  );
  await fallback.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await fallback
    .locator(".band-selector button")
    .filter({ hasText: /^20m/ })
    .click();
  await fallback.locator(".connect").click();
  await fallback.waitForFunction(
    () => {
      const a = document.querySelector("audio");
      return (
        !a.paused &&
        !a.muted &&
        a.currentTime > 0.5 &&
        a.srcObject instanceof MediaStream &&
        a.srcObject.active &&
        document.querySelector(".header-right").textContent.includes("ONLINE")
      );
    },
    {},
    { timeout: 45000 },
  );
  assert.ok(
    (await fallback.locator(".background-audio").innerText()).includes(
      "фоновый поток недоступен",
    ),
  );
  await fallback.locator(".connect").click();
  await fallback.close();
  pass(
    "unavailable native endpoint preserves ordinary real PCM with truthful background status",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/native-background-report.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        platform:
          "desktop Chromium with Android/DuckDuckGo UA; suspended AudioContext and suppressed PCM delivery; live Kiwi; not physical Xiaomi/DuckDuckGo",
        checks,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
