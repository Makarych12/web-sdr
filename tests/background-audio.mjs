import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const url = process.env.TEST_APP_URL || "http://localhost:5173";
const dir = process.env.TEST_ARTIFACT_DIR || "artifacts/background-audio";
mkdirSync(dir, { recursive: true });
const report = {
  url,
  platform:
    "Desktop Chromium; lifecycle simulation, NOT a physical Android screen-lock test",
  checks: [],
  errors: [],
};
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => report.errors.push(e.message));
await page.addInitScript(() => {
  window.__bg = {
    sockets: [],
    elements: [],
    contexts: [],
    actions: {},
    commands: [],
    packets: 0,
    closes: 0,
  };
  const W = WebSocket;
  window.WebSocket = class extends W {
    send(value) {
      if (typeof value === "string" && value.startsWith("SET mod="))
        window.__bg.commands.push({ url: this.url, value });
      super.send(value);
    }
    constructor(...a) {
      super(...a);
      if (!new URL(this.url).pathname.includes("/ws/kiwi/")) return;
      window.__bg.sockets.push(this);
      this.addEventListener("close", () => window.__bg.closes++);
      this.addEventListener("message", (e) => {
        if (e.data instanceof ArrayBuffer) {
          const b = new Uint8Array(e.data);
          if (b[0] === 83 && b[1] === 78) window.__bg.packets++;
        }
      });
    }
  };
  const A = Audio;
  window.Audio = class extends A {
    constructor(...a) {
      super(...a);
      window.__bg.elements.push(this);
    }
  };
  const C = AudioContext;
  window.AudioContext = class extends C {
    constructor(...a) {
      super(...a);
      window.__bg.contexts.push(this);
    }
    createGain() {
      const gain = super.createGain();
      const analyser = this.createAnalyser();
      gain.connect(analyser);
      window.__bg.analyser = analyser;
      return gain;
    }
  };
  if (navigator.mediaSession) {
    const original = navigator.mediaSession.setActionHandler.bind(
      navigator.mediaSession,
    );
    navigator.mediaSession.setActionHandler = (a, fn) => {
      window.__bg.actions[a] = fn;
      original(a, fn);
    };
  }
});
async function snapshot(label) {
  await page.waitForFunction(
    () => {
      const a = window.__bg.analyser;
      if (!a) return false;
      const data = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(data);
      return data.some((v) => Math.abs(v) > 1e-6);
    },
    null,
    { timeout: 5000 },
  );
  const value = await page.evaluate(() => {
    const p = window.__bg,
      a = p.elements[0],
      context = p.contexts[0],
      analyser = p.analyser;
    const data = new Float32Array(analyser?.fftSize || 1);
    analyser?.getFloatTimeDomainData(data);
    return {
      elements: p.elements.length,
      contexts: p.contexts.length,
      context: context?.state,
      audioPaused: a?.paused,
      audioTime: a?.currentTime,
      src: a?.src,
      stream: a?.srcObject instanceof MediaStream,
      track: a?.srcObject?.getAudioTracks()[0]?.readyState,
      packets: p.packets,
      sockets: p.sockets.map((s) => ({ url: s.url, state: s.readyState })),
      closes: p.closes,
      frequency: +document
        .querySelector(".vfo-dial")
        .getAttribute("aria-valuenow"),
      mode: document.querySelector(".modes .selected")?.textContent,
      metadata: navigator.mediaSession?.metadata
        ? {
            title: navigator.mediaSession.metadata.title,
            artist: navigator.mediaSession.metadata.artist,
            album: navigator.mediaSession.metadata.album,
          }
        : null,
      lastTune: p.commands.at(-1),
      mediaState: navigator.mediaSession?.playbackState,
      rms: Math.sqrt(data.reduce((n, v) => n + v * v, 0) / data.length),
    };
  });
  assert.equal(value.elements, 1);
  assert.equal(value.contexts, 1);
  assert.equal(value.context, "running");
  assert.equal(value.audioPaused, false);
  assert.equal(value.stream, true);
  assert.equal(value.track, "live");
  assert.ok(!value.src);
  assert.equal(value.frequency, 14200251);
  assert.equal(value.mode, "USB");
  assert.equal(value.metadata.title, "UR4MTN WEB SDR");
  assert.equal(value.metadata.album, "14.200251 MHz · USB");
  assert.equal(value.mediaState, "playing");
  assert.match(
    value.lastTune.value,
    /mod=usb low_cut=300 high_cut=2700 freq=14200.251$/,
  );
  assert.ok(value.rms > 0);
  report.checks.push({ label, ...value });
  console.log(
    "PASS",
    label,
    JSON.stringify({
      packets: value.packets,
      sockets: value.sockets.length,
      closes: value.closes,
      rms: value.rms,
    }),
  );
  return value;
}
try {
  await page.goto(url + "/#listen");
  await page.waitForFunction(
    () => +document.querySelector(".receiver-choice")?.dataset.count > 0,
  );
  await page.locator("#frequency").fill("14200.251");
  await page.locator("#frequency").press("Enter");
  await page.getByRole("button", { name: "USB", exact: true }).click();
  await page.locator(".receiver .connect").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".header-right").textContent.includes("В эфире"),
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__bg.initialStream = window.__bg.elements[0].srcObject;
    window.__bg.initialReceiver =
      document.querySelector(".receiver-choice").textContent;
  });
  const initial = await snapshot(
    "actual PCM through persistent HTMLAudioElement",
  );
  assert.equal(initial.sockets.length, 2);
  assert.equal(initial.closes, 0);
  await page.evaluate(() => {
    window.__bg.hidden = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => window.__bg.hidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(5000);
  const hidden = await snapshot("hidden lifecycle; same native SND/WF sockets");
  assert.ok(hidden.packets > initial.packets);
  assert.equal(hidden.sockets.length, 2);
  assert.equal(hidden.closes, 0);
  assert.ok(hidden.audioTime > initial.audioTime);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => document.dispatchEvent(new Event("freeze")));
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((r) => setTimeout(r, 1000));
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.evaluate(() => document.dispatchEvent(new Event("resume")));
  await page.waitForTimeout(1000);
  const resumed = await snapshot("resume from actual short Chromium freeze");
  assert.equal(resumed.sockets.length, 2);
  assert.equal(resumed.closes, 0);
  await page.evaluate(async () => {
    await window.__bg.contexts[0].suspend();
    document.dispatchEvent(new Event("resume"));
  });
  await page.waitForFunction(
    () =>
      window.__bg.contexts[0].state === "running" &&
      !window.__bg.elements[0].paused,
  );
  await snapshot("suspended AudioContext resumes without WSS reconnect");
  assert.equal(
    await page.evaluate(
      () => window.__bg.elements[0].srcObject === window.__bg.initialStream,
    ),
    true,
  );
  await page.evaluate(() => {
    window.__bg.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // A real transport interruption reconnects the same endpoint and preserves tune.
  await page.evaluate(() => window.__bg.sockets[0].close());
  await page.waitForFunction(
    () =>
      window.__bg.sockets.length === 4 &&
      document.querySelector(".header-right").textContent.includes("В эфире"),
    null,
    { timeout: 30000 },
  );
  const retried = await snapshot(
    "real WSS close restores same receiver, exact VFO and filter",
  );
  assert.equal(
    new URL(retried.sockets[2].url).host,
    new URL(initial.sockets[0].url).host,
  );
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector(".receiver-choice").textContent ===
        window.__bg.initialReceiver,
    ),
    true,
  );
  await page.evaluate(() => window.__bg.actions.pause());
  await page.waitForFunction(
    () =>
      window.__bg.elements[0].paused &&
      window.__bg.contexts[0].state === "suspended",
  );
  const stoppedCount = await page.evaluate(() => window.__bg.sockets.length);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("resume"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1000);
  assert.equal(
    await page.evaluate(() => window.__bg.sockets.length),
    stoppedCount,
    "lifecycle must not undo a deliberate pause",
  );
  await page.evaluate(() => window.__bg.actions.play());
  await page.waitForFunction(
    () =>
      document.querySelector(".header-right").textContent.includes("В эфире") &&
      !window.__bg.elements[0].paused,
    null,
    { timeout: 30000 },
  );
  await snapshot("Media Session play reuses element and context");
  await page.evaluate(() => window.__bg.actions.stop());
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
