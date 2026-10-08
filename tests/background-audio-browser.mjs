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
  }),
  page = await context.newPage(),
  checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__sockets = [];
  window.__played = 0;
  window.__underflow = 0;
  window.__worklets = 0;
  window.__handlers = {};
  window.__wakeRequests = 0;
  window.__wakeReleases = 0;
  const Native = WebSocket;
  window.WebSocket = class extends Native {
    constructor(...a) {
      super(...a);
      window.__sockets.push(this);
    }
  };
  const Audio = AudioContext;
  window.AudioContext = class extends Audio {
    constructor(...a) {
      super(...a);
      window.__audio = this;
    }
  };
  const Worklet = AudioWorkletNode;
  window.AudioWorkletNode = class extends Worklet {
    constructor(...a) {
      super(...a);
      window.__worklets++;
      this.port.addEventListener("message", (e) => {
        if (e.data.type === "playback") {
          window.__played = e.data.playedFrames;
          window.__underflow = e.data.underflowFrames;
        }
      });
      this.port.start();
    }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...a) {
    if (
      this instanceof GainNode &&
      a[0] instanceof MediaStreamAudioDestinationNode
    ) {
      window.__sink = a[0];
      window.__out = this.context.createAnalyser();
      connect.call(this, window.__out);
    }
    return connect.apply(this, a);
  };
  if (navigator.mediaSession) {
    const set = navigator.mediaSession.setActionHandler.bind(
      navigator.mediaSession,
    );
    navigator.mediaSession.setActionHandler = (action, fn) => {
      window.__handlers[action] = fn;
      return set(action, fn);
    };
  }
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: async (type) => {
        if (type !== "screen") throw Error("invalid lock");
        window.__wakeRequests++;
        const lock = new EventTarget();
        lock.released = false;
        lock.release = async () => {
          if (!lock.released) {
            lock.released = true;
            window.__wakeReleases++;
            lock.dispatchEvent(new Event("release"));
          }
        };
        return lock;
      },
    },
  });
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (window.__blockPlay)
      return Promise.reject(
        new DOMException("test autoplay denied", "NotAllowedError"),
      );
    return play.call(this);
  };
  window.__setHidden = (value) => {
    window.__hidden = value;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => window.__hidden,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (window.__hidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  };
});
async function healthy() {
  await page.waitForFunction(
    () => {
      const audio = document.querySelector("audio.radio-audio-output"),
        a = window.__out;
      if (
        !audio ||
        audio.paused ||
        window.__audio?.state !== "running" ||
        !(audio.srcObject instanceof MediaStream) ||
        !audio.srcObject.active ||
        !a ||
        +document.querySelector(".fall canvas").dataset.rows < 12 ||
        !document.querySelector(".header-right").textContent.includes("ONLINE")
      )
        return false;
      const pcm = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(pcm);
      return pcm.some((v) => Math.abs(v) > 1e-6);
    },
    {},
    { timeout: 45000 },
  );
}
async function sample() {
  return page.evaluate(() => ({
    sockets: window.__sockets.length,
    worklets: window.__worklets,
    played: window.__played,
    underflow: window.__underflow,
    time: window.__audio.currentTime,
    audioTime: document.querySelector("audio").currentTime,
    frequency: document.querySelector("#frequency").value,
    mode: document.querySelector(".modes .selected").textContent,
    filter: document.querySelector("#filter-width").value,
    agc: document.querySelector("#agc").value,
    receiver: document.querySelector("#receiver").value,
    rows: document.querySelector(".fall canvas").dataset.rows,
    frames: document.querySelector(".fall canvas").dataset.frames,
    paused: document.querySelector("audio").paused,
    ctx: window.__audio.state,
  }));
}
function pass(label, detail) {
  checks.push({ label, detail });
  console.log("PASS", label, detail ?? "");
}
try {
  await page.goto(process.env.TEST_BACKGROUND_URL || "http://127.0.0.1:5173");
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  await page
    .locator(".band-selector button")
    .filter({ hasText: /^20m/ })
    .click();
  await page.getByLabel("Полоса фильтра", { exact: true }).selectOption("1800");
  await page.getByLabel("AGC", { exact: true }).selectOption("fast");
  await page.locator(".connect").click();
  await healthy();
  const first = await sample();
  assert.ok(
    await page.evaluate(
      () => document.querySelector("audio").srcObject === window.__sink.stream,
    ),
  );
  assert.equal(first.worklets, 1);
  assert.equal(await page.evaluate(() => window.__wakeRequests), 0);
  assert.deepEqual(
    await page.evaluate(() => Object.keys(window.__handlers).sort()),
    ["pause", "play", "stop"],
  );
  assert.ok(
    await page.evaluate(
      () =>
        navigator.mediaSession.metadata.artist === "UR4MTN WEB SDR" &&
        navigator.mediaSession.metadata.title.includes("14.200000 MHz · USB"),
    ),
  );
  pass(
    "real PCM through persistent MediaStream/audio, Media Session metadata and no automatic Wake Lock",
    first,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await healthy();
  assert.equal((await sample()).sockets, first.sockets);
  pass("online/foreground recovery preserves healthy sockets");
  const other = await context.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  const actualTabHidden = await page.evaluate(() => document.hidden);
  await page.bringToFront();
  await other.close();
  pass("desktop tab switch", { actualTabHidden });
  await page.getByLabel("Оставлять экран включённым", { exact: true }).check();
  await page.waitForFunction(() => window.__wakeRequests === 1);
  await page.evaluate(() => window.__setHidden(true));
  await page.waitForFunction(() => window.__wakeReleases === 1);
  const hiddenStart = await sample();
  const seconds = Number(process.env.TEST_BACKGROUND_SECONDS || 120);
  for (let elapsed = 0; elapsed < seconds; elapsed += 30) {
    await new Promise((r) =>
      setTimeout(r, Math.min(30, seconds - elapsed) * 1000),
    );
    const s = await sample();
    assert.equal(s.paused, false);
    assert.equal(s.ctx, "running");
    assert.equal(s.sockets, hiddenStart.sockets);
    assert.equal(s.frames, hiddenStart.frames);
    assert.ok(s.played > hiddenStart.played);
    pass(
      `logical hidden page with real PCM: ${Math.min(elapsed + 30, seconds)} seconds`,
      s,
    );
  }
  await page.evaluate(() => window.__setHidden(false));
  await healthy();
  await page.waitForFunction(() => window.__wakeRequests === 2);
  await page
    .getByLabel("Оставлять экран включённым", { exact: true })
    .uncheck();
  await page.waitForFunction(() => window.__wakeReleases === 2);
  pass(
    "waterfall restores fresh rows; opt-in Wake Lock releases/reacquires on visibility",
  );
  await page
    .getByRole("checkbox", { name: "Фоновый эфир", exact: true })
    .uncheck();
  await page.evaluate(() => window.__setHidden(true));
  await page.waitForFunction(
    () =>
      document.querySelector("audio").paused &&
      window.__audio.state === "suspended",
  );
  assert.ok(
    !(await page.locator(".header-right").innerText()).includes("ONLINE"),
  );
  await page.evaluate(() => window.__setHidden(false));
  await healthy();
  await page
    .getByRole("checkbox", { name: "Фоновый эфир", exact: true })
    .check();
  assert.equal((await sample()).sockets, first.sockets);
  pass(
    "background opt-out pauses when hidden and resumes in foreground without reconnect",
  );
  await page.evaluate(async () => {
    window.__blockPlay = true;
    document.querySelector("audio").pause();
    await window.__audio.suspend();
  });
  await page
    .getByRole("button", { name: "Возобновить звук", exact: true })
    .waitFor();
  assert.ok(
    !(await page.locator(".header-right").innerText()).includes("ONLINE"),
  );
  await page.evaluate(() => (window.__blockPlay = false));
  await page
    .getByRole("button", { name: "Возобновить звук", exact: true })
    .click();
  await healthy();
  assert.equal((await sample()).worklets, 1);
  pass(
    "autoplay-denied interruption exposes recovery button and truthful status",
  );
  for (const event of ["waiting", "stalled", "ended"]) {
    await page
      .locator("audio")
      .evaluate((audio, event) => audio.dispatchEvent(new Event(event)), event);
    await healthy();
  }
  pass("media waiting/stalled/ended handlers recover existing output");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((r) => setTimeout(r, 3000));
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.evaluate(() => document.dispatchEvent(new Event("resume")));
  await healthy();
  await cdp.detach();
  pass("Chromium lifecycle freeze/resume recovers real PCM");
  await page.evaluate(() => window.__sockets.at(-1).close());
  await page.waitForFunction((n) => window.__sockets.length > n, first.sockets);
  await healthy();
  const reconnected = await sample();
  for (const key of ["frequency", "mode", "filter", "agc", "receiver"])
    assert.equal(reconnected[key], first[key]);
  pass(
    "broken transport reconnects with frequency/mode/filter/AGC/receiver preserved",
    reconnected,
  );
  await page.evaluate(() => window.__handlers.pause());
  await page.waitForFunction(() => document.querySelector("audio").paused);
  assert.ok(
    !(await page.locator(".header-right").innerText()).includes("ONLINE"),
  );
  assert.equal(
    await page.evaluate(() => navigator.mediaSession.playbackState),
    "paused",
  );
  await page.evaluate(() => window.__handlers.play());
  await healthy();
  assert.equal((await sample()).worklets, 1);
  pass("Media Session play/pause reuses worklet and stream");
  await page.reload();
  await healthy();
  const restored = await sample();
  for (const key of ["frequency", "mode", "filter", "agc", "receiver"])
    assert.equal(restored[key], first[key]);
  pass(
    "discard/reload restores tuning and playback intent when autoplay is permitted",
    restored,
  );
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 1600 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page
      .locator(".background-audio")
      .screenshot({ path: `artifacts/background-audio-${width}.png` });
  }
  pass("mobile layouts 320/390/820 have no horizontal overflow");
  await page.evaluate(() => window.__handlers.stop());
  await page.waitForFunction(() => document.querySelector("audio").paused);
  await page.reload();
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 20,
  );
  assert.equal(
    (await page.locator(".connect").innerText()).trim(),
    "▶ Слушать эфир",
  );
  pass("explicit Media Session stop is not restarted by pageshow/reload");
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/background-audio-report.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        platform:
          "desktop Chromium; logical hidden-page test and CDP freeze; Wake Lock/action handlers instrumented; no physical Android/iOS/Bluetooth",
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
