import test from "node:test";
import assert from "node:assert/strict";
import { signalLabel, passband } from "../src/radio.ts";
test("HF meter uses S9 = -73 dBm and 6 dB per S unit", () => {
  assert.equal(signalLabel(-73), "S9");
  assert.equal(signalLabel(-79), "S8");
  assert.equal(signalLabel(-121), "S1");
  assert.equal(signalLabel(-200), "S0");
  assert.equal(signalLabel(-53), "S9 +20");
});
test("USB/LSB mirror filters; AM centers at zero and CW at 600 Hz", () => {
  assert.deepEqual(passband("USB", 1800), { lowCut: 300, highCut: 2100 });
  assert.deepEqual(passband("LSB", 1800), { lowCut: -2100, highCut: -300 });
  assert.deepEqual(passband("CW", 250), { lowCut: 475, highCut: 725 });
  assert.deepEqual(passband("AM", 5000), { lowCut: -2500, highCut: 2500 });
});
