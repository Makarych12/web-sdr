import test from "node:test";
import assert from "node:assert/strict";
import { nativeAudioURL } from "../src/nativeAudio.ts";
test("native audio follows frequency/mode/filter/AGC but ignores panorama zoom/pan", () => {
  const config = {
    receiver: "niendorf",
    frequency: 14200,
    mode: "USB",
    zoom: 5,
    viewCenter: 14200,
    agc: "slow" as const,
    lowCut: 300,
    highCut: 2700,
  };
  const first = nativeAudioURL("https://web-sdr.vercel.app", config);
  assert.equal(
    nativeAudioURL("https://web-sdr.vercel.app", {
      ...config,
      zoom: 10,
      viewCenter: 14300,
    }),
    first,
  );
  for (const change of [
    { frequency: 7100 },
    { mode: "AM" },
    { highCut: 1800 },
    { agc: "fast" as const },
    { receiver: "france" },
  ])
    assert.notEqual(
      nativeAudioURL("https://web-sdr.vercel.app", { ...config, ...change }),
      first,
    );
});
