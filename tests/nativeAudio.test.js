import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  audioTune,
  MP3Stream,
  installNativeAudio,
} from "../server/nativeAudio.js";
import { KiwiProtocol } from "../shared/kiwiProtocol.js";
test("native audio validates tuning and encodes measured Kiwi PCM without waterfall", () => {
  assert.throws(() =>
    audioTune({ receiver: "x", frequency: "NaN", mode: "AM" }),
  );
  assert.throws(() =>
    audioTune({ receiver: "x", frequency: "14200", mode: "IQ" }),
  );
  const tune = audioTune({
    receiver: "x",
    frequency: "14200",
    mode: "USB",
    lowCut: "300",
    highCut: "2700",
    agc: "fast",
  });
  assert.equal(tune.frequency, 14200);
  const chunks = [],
    mp3 = new MP3Stream((b) => chunks.push(b));
  mp3.accept({ type: "audio", sampleRate: 11998.9 });
  assert.equal(mp3.rate, 12000);
  mp3.accept(new Uint8Array([2, 1, 2]));
  mp3.accept(new Uint8Array([1, 2]));
  assert.equal(chunks.length, 0);
  const packet = new Uint8Array(2401);
  packet[0] = 1;
  for (let i = 0; i < 3; i++) mp3.accept(packet);
  mp3.finish();
  assert.ok(Buffer.concat(chunks).length > 1000);
  assert.throws(() => mp3.accept({ type: "audio", sampleRate: NaN }));
});
test("audio-only Kiwi maintains keepalive without waiting for waterfall", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"] });
  const sockets = [],
    events = [];
  const session = new KiwiProtocol(
    "https://example.org",
    (v) => events.push(v),
    (url) => {
      const s = { url, readyState: 1, on() {}, send() {}, close() {} };
      sockets.push(s);
      return s;
    },
    { audioOnly: true },
  );
  session.start({ frequency: 14200, mode: "USB", zoom: 0 });
  assert.equal(sockets.length, 1);
  assert.ok(String(sockets[0].url).endsWith("/SND"));
  for (let i = 0; i < 35; i++) {
    const snd = new Uint8Array(12);
    snd.set(new TextEncoder().encode("SND"));
    session.parse(sockets[0], "SND", snd);
    t.mock.timers.tick(1000);
  }
  assert.equal(session.closed, false);
  assert.ok(!events.some((v) => v.type === "error"));
  session.close();
});
test("native HTTP stream is uncached and releases upstream on client disconnect", async (t) => {
  const app = express(),
    sessions = [];
  class FakeSession {
    constructor(url, emit, options) {
      this.emit = emit;
      this.options = options;
      sessions.push(this);
    }
    start(tune) {
      this.tune = tune;
      this.emit({ type: "audio", sampleRate: 12000 });
      this.timer = setInterval(() => {
        const p = new Uint8Array(2401);
        p[0] = 1;
        this.emit(p);
      }, 5);
    }
    apply(tune) {
      this.tune = tune;
      this.updates = (this.updates || 0) + 1;
    }
    close() {
      this.closed = true;
      clearInterval(this.timer);
    }
  }
  installNativeAudio(
    app,
    { find: (id) => (id === "valid" ? { url: "https://example.org" } : null) },
    Promise.resolve(),
    { Session: FakeSession, lifetimeMs: 0 },
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    sessions.forEach((s) => s.close());
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/audio`;
  assert.equal(
    (await fetch(`${base}?receiver=valid&frequency=bad&mode=AM`)).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}?receiver=missing&frequency=14200&mode=USB`)).status,
    404,
  );
  const session = "c5cfb065-b7f4-4a8a-aec9-0f3c2908d5d8";
  const response = await fetch(
    `${base}?session=${session}&receiver=valid&frequency=14200&mode=USB&agc=slow`,
  );
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.ok(response.headers.get("cache-control").includes("no-store"));
  const control = `${base}/tune?session=${session}&receiver=valid&mode=USB&agc=fast`;
  assert.equal(
    (await fetch(`${control}&frequency=7100&sequence=2`)).status,
    200,
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].tune.frequency, 7100);
  assert.equal(sessions[0].updates, 1);
  await fetch(`${control}&frequency=14200&sequence=1`);
  assert.equal(sessions[0].tune.frequency, 7100);
  assert.equal(
    (await fetch(`${control}&frequency=NaN&sequence=3`)).status,
    400,
  );
  const reader = response.body.getReader();
  assert.ok((await reader.read()).value.length > 0);
  await reader.cancel();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sessions[0].options.audioOnly, true);
  assert.equal(sessions[0].closed, true);
});

test("cold audio request still streams after the serverless adapter drains and destroys the request", async (t) => {
  const app = express();
  let ready,
    drainedRequestDestroyed = false,
    session;
  const catalogReady = new Promise((resolve) => {
    ready = resolve;
  });
  app.use((req, res, next) => {
    // Real IncomingMessage autoDestroy, as with adapters consuming the body.
    req.resume();
    req.once("end", () =>
      setTimeout(() => {
        drainedRequestDestroyed = req.destroyed;
        assert.equal(res.destroyed, false);
        ready();
      }, 20),
    );
    next();
  });
  class ColdSession {
    constructor(url, emit) {
      this.emit = emit;
      session = this;
    }
    start() {
      this.emit({ type: "audio", sampleRate: 12000 });
      this.timer = setInterval(() => {
        const pcm = new Uint8Array(2401);
        pcm[0] = 1;
        this.emit(pcm);
      }, 5);
    }
    close() {
      clearInterval(this.timer);
    }
  }
  installNativeAudio(
    app,
    { find: () => ({ url: "https://example.org" }) },
    catalogReady,
    { Session: ColdSession, lifetimeMs: 0 },
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    session?.close();
    server.closeAllConnections();
    server.close();
  });
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/audio?receiver=valid&frequency=14200&mode=USB`,
    { signal: AbortSignal.timeout(2000) },
  );
  const reader = response.body.getReader();
  assert.ok((await reader.read()).value.length > 0);
  assert.equal(drainedRequestDestroyed, true);
  assert.equal(response.status, 200);
  await reader.cancel();
});
