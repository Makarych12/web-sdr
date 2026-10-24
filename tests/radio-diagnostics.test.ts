import test from "node:test";
import assert from "node:assert/strict";
import { RadioDiagnostics } from "../src/radioDiagnostics.ts";

test("journal preserves last PCM and close reason across reload, bounded to 120 rows", () => {
  let saved = "", now = 10000;
  const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value; } };
  const log = new RadioDiagnostics(storage, () => now);
  log.snapshot = () => ({ context: "running", wssState: 1 });
  log.pcm(); now += 100;
  log.pcm();
  assert.equal(log.text().split("\n").length, 1, "PCM persistence must be throttled");
  log.record("freeze");
  let row = JSON.parse(log.text().split("\n").at(-1)!);
  assert.equal(row.lastPcm, new Date(now).toISOString());
  assert.equal(row.context, "running");
  for (let i = 0; i < 200; i++) log.record("event");
  log.record("wss_close", { code: 1006, reason: "", clean: false });
  const restored = new RadioDiagnostics(storage, () => now + 75000);
  assert.equal(restored.text().split("\n").length, 120);
  row = JSON.parse(restored.text().split("\n").at(-1)!);
  assert.equal(row.code, 1006);
  restored.record("resume");
  row = JSON.parse(restored.text().split("\n").at(-1)!);
  assert.equal(row.pcmAgeMs, 75000);
});

test("denied or corrupt storage never interrupts reception", () => {
  const log = new RadioDiagnostics({ getItem() { throw Error("denied"); }, setItem() { throw Error("full"); } });
  assert.doesNotThrow(() => { log.pcm(); log.record("freeze"); });
  assert.equal(log.persistent, false);
  assert.match(log.text(), /freeze/);
});
