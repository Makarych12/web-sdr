import test from "node:test";
import assert from "node:assert/strict";
import {
  viewFor,
  projectView,
  matchesRequest,
  frequencyLabel,
} from "../src/spectrumView.ts";
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
