import test from "node:test";
import assert from "node:assert/strict";
import {
  waterfallColor,
  clampByte,
  limitWaterfallSpikes,
} from "../src/spectrumRenderer.ts";

test("waterfall palette clamps calibrated power and resolves weak real signals", () => {
  assert.deepEqual(waterfallColor(0, -13), [2, 5, 13, 255]);
  assert.deepEqual(waterfallColor(255, -13), [226, 44, 29, 255]);
  assert.deepEqual(waterfallColor(175, -13), waterfallColor(185, -23));
  const colors = Array.from({ length: 91 }, (_, i) =>
    waterfallColor(153 + i, -13),
  );
  assert.ok(new Set(colors.map(String)).size > 85);
  for (const bin of [NaN, -Infinity, Infinity, -1, 0, 153, 240, 255, 256]) {
    for (const calibration of [NaN, -Infinity, Infinity, -13, 0]) {
      const color = waterfallColor(bin, calibration);
      assert.ok(color.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
      assert.ok(color[0] < 250 || color[1] < 250 || color[2] < 250);
    }
  }
  assert.deepEqual(waterfallColor(NaN, NaN), waterfallColor(0, -13));
});
import {
  viewFor,
  projectView,
  matchesRequest,
  frequencyLabel,
  filterPosition,
} from "../src/spectrumView.ts";
test("filter highlight clips USB/LSB edges and remains visible with off-screen VFO", () => {
  const view = { start: 7000, span: 10 };
  assert.deepEqual(filterPosition(view, 7000, -3000, 3000), {
    left: 0,
    width: 30,
  });
  const usb = filterPosition(view, 7009, 300, 2700)!;
  assert.ok(Math.abs(usb.left - 93) < 1e-8);
  assert.ok(Math.abs(usb.width - 7) < 1e-8);
  assert.deepEqual(filterPosition(view, 7011, -3000, -300), {
    left: 80,
    width: 20,
  });
  assert.equal(filterPosition(view, 6990, 300, 2700), null);
  assert.equal(filterPosition(view, 7020, -2700, -300), null);
});
test("range clamps to real receiver bandwidth and keeps requested zoom", () => {
  assert.deepEqual(viewFor(-100, 6, 32000), {
    start: 0,
    span: 500,
    bandwidth: 32000,
    zoom: 6,
  });
  assert.equal(viewFor(31999, 6, 32000).start, 31500);
  assert.equal(viewFor(7074, 14, 32000).span, 32000 / 2 ** 14);
});
test("pan and zoom reproject existing history into the real range", () => {
  const before = { start: 7000, span: 500 };
  assert.deepEqual(projectView(before, { start: 7100, span: 500 }, 1000), {
    x: -200,
    width: 1000,
  });
  assert.deepEqual(projectView(before, { start: 7125, span: 250 }, 1000), {
    x: -500,
    width: 2000,
  });
});
test("stale waterfall packets cannot acknowledge a newer zoom/pan", () => {
  const request = viewFor(7074, 8, 32000);
  assert.equal(
    matchesRequest({ ...request, start: request.start - 0.001 }, request),
    true,
  );
  assert.equal(matchesRequest(viewFor(7300, 8, 32000), request), false);
  assert.equal(matchesRequest(viewFor(7074, 7, 32000), request), false);
  assert.equal(
    matchesRequest({ ...request, span: request.span * 2 }, request),
    false,
  );
  assert.equal(matchesRequest({ ...request, span: NaN }, request), false);
});
test("high zoom frequency labels keep Hz precision instead of duplicate MHz ticks", () => {
  assert.equal(frequencyLabel(7074.125, 1.953125), "7074.125 kHz");
  assert.notEqual(
    frequencyLabel(7074.125, 1.953125),
    frequencyLabel(7074.625, 1.953125),
  );
});

test("clamp and isolated-spike protection preserve contiguous real carriers", () => {
  assert.equal(clampByte(NaN), 0);
  assert.equal(clampByte(-1), 0);
  assert.equal(clampByte(999), 255);
  const bins = new Uint8Array([170, 170, 255, 170, 170, 250, 250, 170]);
  const limited = limitWaterfallSpikes(bins);
  assert.ok(limited[2] < 255 && limited[2] > 170);
  assert.equal(limited[5], 250);
  assert.equal(limited[6], 250);
  assert.equal(bins[2], 255);
});
