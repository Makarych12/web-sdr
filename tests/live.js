import WebSocket from "ws";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const socket = new WebSocket(process.env.TEST_URL || "ws://localhost:8787/ws");
const stages = [
  { frequency: 10000, mode: "AM", zoom: 6 },
  { frequency: 7074, mode: "USB", zoom: 7 },
  { frequency: 7100, mode: "LSB", zoom: 7 },
  { frequency: 7000, mode: "CW", zoom: 8 },
  { frequency: 27000, mode: "FM", zoom: 6 },
];
if (process.env.TEST_FILTERS) {
  stages.push(
    { frequency: 10000, mode: "AM", zoom: 6, lowCut: -2500, highCut: 2500 },
    { frequency: 7074, mode: "USB", zoom: 7, lowCut: 300, highCut: 2100 },
    { frequency: 7100, mode: "LSB", zoom: 7, lowCut: -3300, highCut: -300 },
    { frequency: 7000, mode: "CW", zoom: 8, lowCut: 475, highCut: 725 },
    { frequency: 27000, mode: "FM", zoom: 6, lowCut: -3000, highCut: 3000 },
  );
}
if (process.env.TEST_PAN) {
  stages.push(
    { frequency: 10000, mode: "AM", zoom: 8, viewCenter: 10400 },
    { frequency: 10000, mode: "AM", zoom: 10, viewCenter: 9900 },
    { frequency: 7000, mode: "CW", zoom: 13, viewCenter: 7000 },
  );
}
let acknowledged;
let stage = 0,
  audio = 0,
  wf = 0,
  view,
  rate,
  parts = [],
  rms = 0,
  verified = false,
  done = false;
const report = [];
const progress = setInterval(
  () => console.log({ stage, audio, wf, view, rate, rms, verified }),
  5000,
);
const timeout = setTimeout(
  () =>
    finish(
      Error(
        "Live verification timed out " +
          JSON.stringify({ stage, audio, wf, view, rate, rms, verified }),
      ),
    ),
  60000,
);
function finish(e) {
  if (done) return;
  done = true;
  clearTimeout(timeout);
  clearInterval(progress);
  socket.close();
  if (e) {
    console.error(e);
    process.exitCode = 1;
  } else {
    mkdirSync("artifacts", { recursive: true });
    const pcm = Buffer.concat(parts);
    const wav = Buffer.alloc(44);
    wav.write("RIFF");
    wav.writeUInt32LE(36 + pcm.length, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(Math.round(rate), 24);
    wav.writeUInt32LE(Math.round(rate) * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(pcm.length, 40);
    writeFileSync("artifacts/live-audio.wav", Buffer.concat([wav, pcm]));
    writeFileSync(
      "artifacts/live-report.json",
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          receiver: process.env.TEST_RECEIVER || "france",
          sampleRate: rate,
          stages: report,
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS: ${report.length} real stream stages. WAV and report saved to artifacts/.`,
    );
  }
}
socket.on("open", () =>
  socket.send(
    JSON.stringify({
      type: "connect",
      receiver: process.env.TEST_RECEIVER || "france",
      ...stages[0],
    }),
  ),
);
socket.on("error", finish);
socket.on("message", (raw, binary) => {
  try {
    if (!binary) {
      const v = JSON.parse(raw);
      if (v.type === "error") return finish(Error(v.message));
      if (v.type === "audio") rate = v.sampleRate;
      if (v.type === "view") view = v;
      if (v.type === "tuned") {
        verified = true;
        acknowledged = v;
      }
    } else if (raw[0] === 1) {
      audio++;
      let energy = 0;
      const pcm = Buffer.alloc(raw.length - 1);
      for (let i = 1; i + 1 < raw.length; i += 2) {
        const n = raw.readInt16BE(i);
        pcm.writeInt16LE(n, i - 1);
        energy += n * n;
      }
      rms = Math.sqrt(energy / ((raw.length - 1) / 2));
      if (stage === 0) parts.push(pcm);
    } else if (raw[0] === 2) {
      assert.equal(raw.length, 1025);
      assert.ok(new Set(raw.subarray(1)).size > 5);
      wf++;
    }
    const target = stages[stage];
    const center = target.viewCenter ?? target.frequency;
    if (
      verified &&
      audio >= 10 &&
      wf >= 5 &&
      view &&
      center >= view.start &&
      center <= view.start + view.span &&
      Math.abs(view.span - view.bandwidth / 2 ** target.zoom) < 1 &&
      Math.abs(center - (view.start + view.span / 2)) <
        Math.max(0.01, view.span / 512) &&
      rms > 0
    ) {
      if (target.lowCut !== undefined) {
        assert.equal(acknowledged.lowCut, target.lowCut);
        assert.equal(acknowledged.highCut, target.highCut);
      }
      console.log("Verified", target.mode);
      report.push({
        ...target,
        audioPackets: audio,
        waterfallRows: wf,
        rms,
        view,
      });
      stage++;
      if (stage === stages.length) return finish();
      audio = 0;
      wf = 0;
      verified = false;
      view = null;
      socket.send(JSON.stringify({ type: "tune", ...stages[stage] }));
    }
  } catch (e) {
    finish(e);
  }
});
