import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { HlsEncoder, trimHlsSegment } from "../server/hlsEncoder.js";

test("HLS encodes real PCM as decodable AAC/TS and trims the overlap instead of replaying it", async (t) => {
  const segments = [],
    errors = [];
  const encoder = new HlsEncoder(
    (bytes, duration, capturedAt) =>
      segments.push({ bytes, duration, capturedAt }),
    (error) => errors.push(error),
  );
  t.after(() => encoder.finish());
  assert.throws(() => encoder.accept({ type: "audio", sampleRate: NaN }));
  encoder.accept({ type: "audio", sampleRate: 11998.9 });
  for (let packet = 0; packet < 40; packet++) {
    const pcm = new Uint8Array(2401),
      view = new DataView(pcm.buffer);
    pcm[0] = 1;
    for (let i = 0; i < 1200; i++)
      view.setInt16(
        1 + i * 2,
        Math.round(
          10000 * Math.sin((2 * Math.PI * 540 * (packet * 1200 + i)) / 12000),
        ),
        false,
      );
    encoder.accept(pcm);
  }
  await encoder.finish();
  assert.deepEqual(errors, []);
  assert.ok(segments.length >= 2);
  assert.ok(
    segments.every((s) => s.bytes[0] === 0x47 && s.bytes.length % 188 === 0),
  );
  assert.ok(Number.isFinite(segments[0].capturedAt));
  const decode = (bytes) => {
    const result = spawnSync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-map",
        "0:a:0",
        "-f",
        "f32le",
        "-ar",
        "24000",
        "-ac",
        "1",
        "pipe:1",
      ],
      { input: bytes },
    );
    assert.equal(result.status, 0, result.stderr.toString());
    const samples = new Float32Array(
      result.stdout.buffer.slice(
        result.stdout.byteOffset,
        result.stdout.byteOffset + result.stdout.byteLength,
      ),
    );
    assert.ok(samples.some((sample) => Math.abs(sample) > 0.05));
    return samples.length / 24000;
  };
  const original = decode(segments[0].bytes);
  const shortened = decode(await trimHlsSegment(segments[0].bytes, 1));
  assert.ok(Math.abs(original - segments[0].duration) < 0.1);
  assert.ok(
    Math.abs(original - shortened - 1) < 0.1,
    "overlapping audio must be removed",
  );
});
