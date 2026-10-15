import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFrequency,
  stepFrequency,
  STEPS_HZ,
  MODE_STEP,
  filterPreset,
  validCuts,
} from "../src/tuning.ts";
import { readStored } from "../src/storage.ts";
test("frequency input retains every Hz and rejects sub-Hz/invalid units", () => {
  for (const [input, hz] of [
    ["7074", 7074000],
    ["7074.25", 7074250],
    ["7.074 MHz", 7074000],
    ["7074250 Hz", 7074250],
    ["7.074251 MHz", 7074251],
    ["0.001", 1],
  ] as const)
    assert.equal(parseFrequency(input), hz);
  for (const input of [
    "7.0742501 MHz",
    "7074.0001",
    "30.001 MHz",
    "NaN",
    "1 GHz",
    "-5",
  ])
    assert.equal(parseFrequency(input), null);
});
test("all tuning steps are reversible at one-Hz resolution", () => {
  for (const step of STEPS_HZ)
    assert.equal(
      stepFrequency(stepFrequency(7074251, step, 10), step, -10),
      7074251,
    );
  assert.equal(MODE_STEP.USB, 10);
  assert.equal(MODE_STEP.CW, 1);
});
test("sidebands are mirrored and CW centered for each preset", () => {
  for (const preset of ["Narrow", "Normal", "Wide"] as const) {
    const u = filterPreset("USB", preset),
      l = filterPreset("LSB", preset);
    assert.equal(u.lowCut, -l.highCut);
    assert.equal(u.highCut, -l.lowCut);
    assert.ok(validCuts(u));
  }
  assert.deepEqual(filterPreset("USB", "Wide"), { lowCut: 100, highCut: 3000 });
  assert.deepEqual(filterPreset("CW", "Narrow"), {
    lowCut: -250,
    highCut: 250,
  });
  assert.deepEqual(filterPreset("AM", "Narrow"), {
    lowCut: -3000,
    highCut: 3000,
  });
});
test("persisted Hz and asymmetric cuts survive restore; malformed state falls back", () => {
  const store = new Map<string, string>([
    ["hz", "7074251"],
    ["cuts", '{"lowCut":100,"highCut":3000}'],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => store.get(key) },
  });
  assert.equal(
    readStored("hz", 0, (v): v is number => Number.isSafeInteger(v)),
    7074251,
  );
  assert.deepEqual(
    readStored("cuts", filterPreset("AM", "Normal"), validCuts),
    filterPreset("USB", "Wide"),
  );
  store.set("cuts", "broken");
  assert.deepEqual(
    readStored("cuts", filterPreset("AM", "Normal"), validCuts),
    filterPreset("AM", "Normal"),
  );
  Reflect.deleteProperty(globalThis, "localStorage");
});

import { directEndpoint } from "../src/transport.ts";
test("HTTPS Kiwi bypasses gateway unless direct transport actually failed", () => {
  assert.equal(
    directEndpoint("https://kiwi.example:8073"),
    "https://kiwi.example:8073/",
  );
  assert.equal(directEndpoint("https://kiwi.example", true), undefined);
  assert.equal(directEndpoint("http://kiwi.example"), undefined);
  assert.equal(directEndpoint("invalid"), undefined);
});
