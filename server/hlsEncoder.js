import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ffmpeg from "ffmpeg-static";

// Remove the overlap at a producer handoff so cached live audio is not replayed.
export function trimHlsSegment(bytes, seconds) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-ss",
        String(seconds),
        "-map",
        "0:a:0",
        "-c:a",
        "aac",
        "-b:a",
        "48k",
        "-ar",
        "24000",
        "-f",
        "mpegts",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Не удалось состыковать эфир"));
    }, 5000);
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.stderr.resume();
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(Error("Ошибка стыковки эфира"));
    });
    child.stdin.end(bytes);
  });
}

// Native HLS demuxers require AAC in MPEG-TS here. Raw MP3 works as a media
// stream, but Chromium does not start the packed-MP3 HLS rendition.
export class HlsEncoder {
  constructor(emit, onError, segmentSeconds = 2) {
    this.emit = emit;
    this.onError = onError;
    this.seconds = segmentSeconds;
    this.rate = 12000;
    this.seen = new Set();
    this.closed = false;
    this.outputSeconds = 0;
    this.directory = mkdtempSync(join(tmpdir(), "ur4mtn-hls-"));
  }
  start() {
    this.child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "s16be",
        "-ar",
        String(this.rate),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-c:a",
        "aac",
        "-b:a",
        "48k",
        "-ar",
        "24000",
        "-f",
        "hls",
        "-hls_time",
        String(this.seconds),
        "-hls_list_size",
        "0",
        "-hls_segment_filename",
        join(this.directory, "%d.ts"),
        join(this.directory, "index.m3u8"),
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    this.stderr = "";
    this.child.stderr.on("data", (bytes) => {
      this.stderr = (this.stderr + bytes).slice(-1500);
    });
    this.child.on("error", (error) => this.onError(error));
    this.child.stdin.on("error", (error) => {
      if (!this.closed) this.onError(error);
    });
    this.exited = new Promise((resolve) =>
      this.child.once("close", (code) => {
        if (!this.closed && code !== 0)
          this.onError(Error("Ошибка AAC-кодера: " + this.stderr));
        resolve();
      }),
    );
    this.timer = setInterval(() => {
      try {
        this.publish();
      } catch (error) {
        this.onError(error);
      }
    }, 200);
  }
  publish() {
    let playlist;
    try {
      playlist = readFileSync(join(this.directory, "index.m3u8"), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    let duration;
    for (const line of playlist.split("\n")) {
      if (line.startsWith("#EXTINF:"))
        duration = Number(line.slice(8).split(",")[0]);
      else if (/^\d+\.ts$/.test(line) && !this.seen.has(line)) {
        const bytes = readFileSync(join(this.directory, line));
        this.seen.add(line);
        this.emit(bytes, duration, this.startTime + this.outputSeconds * 1000);
        this.outputSeconds += duration;
      }
    }
  }
  accept(value) {
    if (this.closed) return;
    if (value.type === "audio") {
      const rates = [
        8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
      ];
      const nominal = rates.reduce((a, b) =>
        Math.abs(a - value.sampleRate) < Math.abs(b - value.sampleRate) ? a : b,
      );
      if (
        !Number.isFinite(value.sampleRate) ||
        Math.abs(nominal - value.sampleRate) / nominal > 0.01
      )
        throw Error("Неподдерживаемая частота PCM");
      if (this.child && nominal !== this.rate)
        throw Error("Частота PCM изменилась");
      this.rate = nominal;
      return;
    }
    if (
      !(value instanceof Uint8Array) ||
      value[0] !== 1 ||
      value.length < 3 ||
      value.length % 2 !== 1
    )
      return;
    if (!this.child) {
      this.startTime = Date.now() - ((value.length - 1) / 2 / this.rate) * 1000;
      this.start();
    }
    if (this.child.stdin.writableLength > 256 * 1024)
      throw Error("AAC-кодер не успевает обрабатывать эфир");
    this.child.stdin.write(value.subarray(1));
  }
  async finish() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    try {
      if (this.child) {
        const timeout = setTimeout(() => this.child.kill("SIGKILL"), 3000);
        this.child.stdin.end();
        await this.exited;
        clearTimeout(timeout);
        this.publish();
      }
    } finally {
      rmSync(this.directory, { recursive: true, force: true });
    }
  }
}
