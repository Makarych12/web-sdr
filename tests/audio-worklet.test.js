import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
function player() {
  let Processor;
  const context = {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage() {} };
      }
    },
    sampleRate: 48000,
    registerProcessor: (_, value) => (Processor = value),
  };
  vm.runInNewContext(
    readFileSync(
      new URL("../public/audio-worklet.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  return new Processor();
}
test("PCM jitter buffer survives a 60ms main-thread delivery delay without underrun", () => {
  const p = player();
  let next = 0,
    queued = [];
  const input = new Float32Array(512).fill(0.25);
  for (let frame = 0; frame < 1800; frame++) {
    const ms = ((frame * 128) / 48000) * 1000;
    while (ms >= next) {
      queued.push(input.slice());
      next += (512 / 12000) * 1000;
    }
    if (ms < 1000 || ms > 1060) {
      for (const samples of queued)
        p.port.onmessage({ data: { samples, rate: 12000 } });
      queued = [];
    }
    p.process([], [[new Float32Array(128)]]);
  }
  assert.ok(p.playedFrames > 180000);
  assert.equal(p.underflowFrames, 0);
  assert.ok(p.buffered < 12000 * 0.75);
});
test("catching up from an audio burst retains queued live samples instead of restarting", () => {
  const p = player();
  const input = new Float32Array(512).fill(0.25);
  for (let i = 0; i < 24; i++)
    p.port.onmessage({ data: { samples: input.slice(), rate: 12000 } });
  const output = new Float32Array(128);
  p.process([], [[output]]);
  assert.ok(output.slice(-8).every((v) => Math.abs(v - 0.25) < 0.001));
  assert.equal(p.underflowFrames, 0);
  assert.ok(p.buffered < 12000 * 0.75);
  p.port.onmessage({ data: { reset: true } });
  const stopped = new Float32Array(128);
  p.process([], [[stopped]]);
  assert.ok(stopped.every((v) => v === 0));
});

test("oversized PCM packet is bounded and reset removes old audio before the next station", () => {
  const p = player();
  p.port.onmessage({
    data: { samples: new Float32Array(120000).fill(0.75), rate: 12000 },
  });
  assert.ok(p.buffered <= 12000 * 0.75);
  p.targetSeconds = 0.35;
  p.port.onmessage({ data: { reset: true } });
  assert.equal(p.buffered, 0);
  assert.equal(p.queue.length, 0);
  assert.equal(p.targetSeconds, 0.12);
  for (let i = 0; i < 6; i++)
    p.port.onmessage({
      data: { samples: new Float32Array(512).fill(0.25), rate: 12000 },
    });
  const output = new Float32Array(128);
  p.process([], [[output]]);
  assert.ok(
    output.every((v) => v === 0.25),
    "no samples from the previous station",
  );
});

test("long jitter adapts, bounded queue recovers, and stable delivery lowers target", () => {
  const p = player(),
    input = new Float32Array(512).fill(0.2);
  for (let i = 0; i < 4; i++)
    p.port.onmessage({ data: { samples: input.slice() } });
  for (let i = 0; i < 200; i++) p.process([], [[new Float32Array(128)]]);
  assert.ok(p.underflowFrames > 0);
  assert.ok(p.targetSeconds > 0.12);
  let next = 0;
  for (let frame = 0; frame < 30000; frame++) {
    const time = (frame * 128) / 48000;
    while (time >= next) {
      p.port.onmessage({ data: { samples: input.slice() } });
      next += 512 / 12000;
    }
    p.process([], [[new Float32Array(128)]]);
    assert.ok(p.buffered <= 12000 * 0.45);
  }
  assert.ok(p.targetSeconds < 0.16 && p.targetSeconds >= 0.12);
});
