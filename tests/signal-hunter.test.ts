import test from "node:test";
import assert from "node:assert/strict";
import { SignalHunter } from "../src/signalHunter.ts";
const view = { start: 14000, span: 200, zoom: 7, bandwidth: 30000 };
function noise(frame: number) {
  return Uint8Array.from(
    { length: 1024 },
    (_, i) => 100 + Math.floor(i / 256) * 4 + ((i * 13 + frame * 7) % 5),
  );
}
function peak(bins: Uint8Array, center: number, extra: number) {
  for (let d = -2; d <= 2; d++)
    bins[center + d] += Math.round(extra * (1 - Math.abs(d) * 0.2));
}
test("hunter: adaptive floor, persistence, merging, sensitivity, expiry and view isolation", () => {
  const detector = new SignalHunter(55);
  for (let frame = 0; frame < 15; frame++) {
    const bins = noise(frame);
    if (frame === 0) peak(bins, 450, 60);
    detector.push(bins, view, -13, frame * 200);
  }
  assert.equal(
    detector.snapshot(2800).length,
    0,
    "random/slope noise and one-frame impulse must not be visible",
  );
  detector.reset();
  for (let frame = 0; frame < 12; frame++) {
    const bins = noise(frame);
    peak(bins, 200, 35);
    peak(bins, 204, 32);
    peak(bins, 700, 30);
    const before = bins.slice();
    detector.push(bins, view, -13, frame * 200);
    assert.deepEqual(bins, before, "never mutate the shared FFT");
    if (frame < 5) assert.equal(detector.snapshot(frame * 200).length, 0);
  }
  const found = detector.snapshot(2200);
  assert.equal(found.length, 2, "nearby peaks are one signal-energy island");
  assert(
    found.some(
      (p) =>
        Math.abs(p.frequency - (view.start + (202 / 1024) * view.span)) < 1,
    ),
  );
  assert(found.every((p) => p.excessDb > 10));
  const ids = found.map((p) => p.id);
  const bins = noise(13);
  peak(bins, 201, 35);
  peak(bins, 205, 32);
  peak(bins, 701, 30);
  detector.push(bins, view, -13, 2400);
  assert.deepEqual(
    detector.snapshot(2400).map((p) => p.id),
    ids,
    "small drift keeps stable marker identities",
  );
  assert.equal(detector.snapshot(4000).length, 0, "stale input expires");
  detector.push(noise(0), { ...view, start: 7000 }, -13, 4200);
  assert.equal(
    detector.snapshot(4200).length,
    0,
    "old RF view must never carry over",
  );
  const high = new SignalHunter(100),
    low = new SignalHunter(0);
  for (let frame = 0; frame < 12; frame++) {
    const bins = new Uint8Array(1024).fill(100);
    peak(bins, 500, 11);
    high.push(bins, view, -13, frame * 200);
    low.push(bins, view, -13, frame * 200);
  }
  assert.equal(high.snapshot(2200).length, 1);
  assert.equal(low.snapshot(2200).length, 0);
  const saturated = new SignalHunter(100);
  for (let frame = 0; frame < 12; frame++) {
    const bins = new Uint8Array(1024).fill(100);
    bins[300] = 255;
    saturated.push(bins, view, -13, frame * 200);
  }
  assert.equal(
    saturated.snapshot(2200).length,
    0,
    "clipped/invalid spikes are suppressed",
  );
  high.reset();
  assert.equal(high.snapshot(2200).length, 0);
});
