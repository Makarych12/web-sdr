import test from "node:test";
import assert from "node:assert/strict";
import { readRadioSession, saveRadioSession } from "../src/radioSession.ts";
test("sleep snapshot restores valid tuning and playback intent, rejects corrupt settings", () => {
  let stored: string | null = null;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    },
  });
  try {
    const session = {
      frequency: 14200.125,
      mode: "USB" as const,
      width: 1800,
      zoom: 8,
      viewCenter: 14200,
      agc: "fast" as const,
      receiver: "niendorf",
      playing: true,
    };
    saveRadioSession(session);
    assert.deepEqual(readRadioSession(), session);
    for (const changes of [
      { frequency: NaN },
      { mode: "IQ" },
      { width: 999999 },
      { zoom: 15 },
      { playing: "true" },
      { receiver: null },
      { agc: "unknown" },
    ]) {
      stored = JSON.stringify({ ...session, ...changes });
      assert.equal(readRadioSession(), null);
    }
    stored = "invalid JSON";
    assert.equal(readRadioSession(), null);
  } finally {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
