import test from "node:test";
import assert from "node:assert/strict";
import { waterfallColor } from "../src/spectrumRenderer.ts";

test("waterfall palette clamps calibrated power and resolves weak real signals", () => {
  assert.deepEqual(waterfallColor(0, -13), [5, 10, 26, 255]);
  assert.deepEqual(waterfallColor(255, -13), [255, 245, 207, 255]);
  assert.deepEqual(waterfallColor(175, -13), waterfallColor(185, -23));
  const colors = Array.from({ length: 91 }, (_, i) =>
    waterfallColor(153 + i, -13),
  );
  assert.ok(new Set(colors.map(String)).size > 85);
  const luminance = ([r, g, b]: number[]) =>
    r * 0.2126 + g * 0.7152 + b * 0.0722;
  for (let i = 1; i < colors.length; i++) {
    assert.ok(luminance(colors[i]) >= luminance(colors[i - 1]) - 0.5);
  }
  assert.ok(luminance(waterfallColor(163, -13)) - luminance(colors[0]) > 20);
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
});
test("high zoom frequency labels keep Hz precision instead of duplicate MHz ticks", () => {
  assert.equal(frequencyLabel(7074.125, 1.953125), "7074.125 kHz");
  assert.notEqual(
    frequencyLabel(7074.125, 1.953125),
    frequencyLabel(7074.625, 1.953125),
  );
});
