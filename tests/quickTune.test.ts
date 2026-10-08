import test from "node:test";
import assert from "node:assert/strict";
import {
  parseQuickFrequency,
  validQuickFrequencies,
  rememberQuickFrequency,
  quickLabel,
  defaultQuickFrequencies,
} from "../src/quickTune.ts";
test("manual quick frequencies accept kHz/MHz and comma decimals with Hz precision", () => {
  assert.equal(parseQuickFrequency("14200", "kHz"), 14200);
  assert.equal(parseQuickFrequency("14,200125", "MHz"), 14200.125);
  assert.equal(parseQuickFrequency(" 7074.001 ", "kHz"), 7074.001);
  for (const v of ["", "-1", "Infinity", "1e4", "30.000001", "text"])
    assert.equal(parseQuickFrequency(v, "MHz"), null);
  assert.equal(parseQuickFrequency("0", "kHz"), null);
  assert.equal(quickLabel(7074.001), "7.074001 MHz");
});
test("saved quick tuning rejects invalid frequency/mode/filter from storage", () => {
  assert.ok(validQuickFrequencies(defaultQuickFrequencies));
  for (const entry of [
    { frequency: NaN, mode: "AM", name: "x" },
    { frequency: 31000, mode: "AM", name: "x" },
    { frequency: 7100, mode: "IQ", name: "x" },
    { frequency: 7100, mode: "USB", width: 12000, name: "x" },
  ])
    assert.equal(validQuickFrequencies([entry]), false);
  assert.ok(
    validQuickFrequencies([
      { frequency: 7100, mode: "USB", width: 1800, name: "test" },
    ]),
  );
});
test("recent tuning deduplicates frequency/mode and restores the latest filter, bounded to six", () => {
  const entries = Array.from({ length: 6 }, (_, i) => ({
    frequency: 7100 + i,
    mode: "USB" as const,
    name: "x",
    width: 2400,
  }));
  const next = rememberQuickFrequency(entries, { ...entries[3], width: 1800 });
  assert.equal(next.length, 6);
  assert.equal(next[0].frequency, 7103);
  assert.equal(next[0].width, 1800);
  assert.equal(
    rememberQuickFrequency(next, { frequency: 14200, mode: "USB", name: "20m" })
      .length,
    6,
  );
  assert.equal(
    rememberQuickFrequency(next, {
      frequency: 7103,
      mode: "LSB",
      name: "different mode",
    })[1].mode,
    "USB",
  );
});
