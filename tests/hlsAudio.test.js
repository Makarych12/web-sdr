import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { installHlsAudio } from "../server/hlsAudio.js";

test("HLS shares segments and tuning across function instances and renews the producer without page JS", async (t) => {
  const values = new Map(),
    jobs = [],
    sessions = [],
    servers = [];
  let holdTune = false,
    releaseTune,
    tuneWriting;
  const tuneStarted = new Promise((resolve) => {
    tuneWriting = resolve;
  });
  const tuneReleased = new Promise((resolve) => {
    releaseTune = resolve;
  });
  const cache = {
    async get(key) {
      return structuredClone(values.get(key));
    },
    async set(key, value) {
      if (
        holdTune &&
        key.endsWith(":control") &&
        value.sequence === 3 &&
        !value.stopped
      ) {
        tuneWriting();
        await tuneReleased;
      }
      values.set(key, structuredClone(value));
    },
    async delete(key) {
      values.delete(key);
    },
  };
  class Encoder {
    constructor(emit) {
      this.emit = emit;
    }
    accept(value) {
      if (value instanceof Uint8Array) this.emit(Buffer.alloc(188, 71), 2);
    }
    async finish() {}
  }
  class Session {
    constructor(url, emit, options) {
      this.emit = emit;
      this.options = options;
      sessions.push(this);
    }
    start(tune) {
      this.tune = tune;
      this.timer = setInterval(() => this.emit(new Uint8Array([1, 0, 0])), 50);
    }
    apply(tune) {
      this.tune = tune;
    }
    close() {
      this.closed = true;
      clearInterval(this.timer);
    }
  }
  for (let i = 0; i < 2; i++) {
    const app = express();
    installHlsAudio(
      app,
      {
        find: (id) => (id === "valid" ? { url: "https://example.org" } : null),
      },
      Promise.resolve(),
      {
        cache,
        Session,
        Encoder,
        keepAlive: (job) => jobs.push(job),
        workerMs: 1700,
        startupMs: 3000,
      },
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    servers.push(server);
  }
  t.after(async () => {
    releaseTune();
    sessions.forEach((session) => session.close());
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
    await Promise.allSettled(jobs);
  });
  const bases = servers.map(
    (server) => `http://127.0.0.1:${server.address().port}`,
  );
  const id = randomUUID();
  const query = `session=${id}&receiver=valid&frequency=14200&mode=USB`;
  assert.equal((await fetch(`${bases[0]}/api/hls?receiver=valid`)).status, 400);
  assert.equal(
    (await fetch(`${bases[0]}/api/hls?${query}&frequency=bad`)).status,
    400,
  );
  const first = await fetch(`${bases[0]}/api/hls?${query}`);
  assert.equal(first.status, 200);
  assert.ok(first.headers.get("content-type").includes("mpegurl"));
  assert.equal(first.headers.get("cache-control"), "no-store");
  const manifest = await first.text();
  assert.ok(!manifest.includes("#EXT-X-ENDLIST"));
  const segment = manifest.split("\n").find((line) => line.startsWith("/api/"));
  const other = await fetch(bases[1] + segment);
  assert.equal(other.status, 200);
  assert.equal((await other.arrayBuffer()).byteLength, 188);
  assert.equal(
    sessions.length,
    1,
    "another invocation reads shared audio without opening another channel",
  );
  const control = `${bases[1]}/api/hls/tune?session=${id}&receiver=valid&mode=USB`;
  assert.equal(
    (await fetch(`${control}&frequency=7100&sequence=2`)).status,
    200,
  );
  const late = await (
    await fetch(`${control}&frequency=14200&sequence=1`)
  ).json();
  assert.equal(late.frequency, 7100);
  await new Promise((resolve) => setTimeout(resolve, 1050));
  assert.equal(sessions[0].tune.frequency, 7100);
  await jobs[0];
  assert.equal(sessions[0].closed, true);
  const second = await fetch(`${bases[1]}/api/hls?${query}`);
  assert.equal(second.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(sessions.length, 2);
  assert.equal(
    sessions[1].tune.frequency,
    7100,
    "renewal retains tuning despite the original media URL",
  );
  const renewed = await (await fetch(`${bases[1]}/api/hls?${query}`)).text();
  assert.ok(renewed.includes("#EXT-X-DISCONTINUITY\n"));
  holdTune = true;
  const delayedTune = fetch(`${control}&frequency=10050&sequence=3`);
  await tuneStarted;
  assert.equal(
    (await fetch(`${bases[0]}/api/hls/stop?session=${id}`)).status,
    204,
  );
  releaseTune();
  await delayedTune;
  assert.equal(
    (await fetch(`${control}&frequency=7100&sequence=4`)).status,
    404,
    "a control write finishing after stop must not resurrect the listener",
  );
  const stopped = await (await fetch(`${bases[0]}/api/hls?${query}`)).text();
  assert.ok(stopped.includes("#EXT-X-ENDLIST"));
  await Promise.all(jobs);
  assert.equal(sessions[1].closed, true);
});
