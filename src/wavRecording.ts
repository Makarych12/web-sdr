import { useCallback, useEffect, useRef, useState } from "react";

export const RECORDING_LIMIT_MS = 10 * 60 * 1000;

/** Copies incoming Kiwi mono PCM (big endian) into WAV PCM (little endian). */
export class WavRecording {
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  samples = 0;
  constructor(readonly sampleRate: number) {}
  get size() { return 44 + this.samples * 2; }
  get full() { return this.samples >= this.sampleRate * 600; }
  append(pcm: Uint8Array) {
    const count = Math.min(Math.floor(pcm.length / 2), this.sampleRate * 600 - this.samples);
    if (count <= 0) return;
    const copy = new Uint8Array(count * 2);
    for (let i = 0; i < copy.length; i += 2) {
      copy[i] = pcm[i + 1];
      copy[i + 1] = pcm[i];
    }
    this.chunks.push(copy);
    this.samples += count;
  }
  finish() {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const text = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, "RIFF"); view.setUint32(4, this.size - 8, true);
    text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, this.samples * 2, true);
    const blob = new Blob([header, ...this.chunks], { type: "audio/wav" });
    this.chunks = [];
    return blob;
  }
}

export function recordingFilename(frequencyKhz: number, mode: string, date: Date) {
  const pad = (v: number) => String(v).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `UR4MTN_${Math.round(frequencyKhz * 1000)}Hz_${mode}_${stamp}.wav`;
}

export function useWavRecording() {
  const active = useRef<{ wav: WavRecording; filename: string; started: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [status, setStatus] = useState<{ seconds: number; bytes: number } | null>(null);
  const stop = useCallback(() => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    clearInterval(timer.current);
    setStatus(null);
    if (!current.wav.samples) return;
    const url = URL.createObjectURL(current.wav.finish());
    const link = document.createElement("a");
    link.href = url;
    link.download = current.filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, []);
  const start = (sampleRate: number, frequency: number, mode: string) => {
    // Kiwi reports a measured rate which can be fractional; WAV stores integer Hz.
    if (active.current || !Number.isFinite(sampleRate) || sampleRate < 1) return;
    sampleRate = Math.round(sampleRate);
    const date = new Date();
    active.current = { wav: new WavRecording(sampleRate), filename: recordingFilename(frequency, mode, date), started: Date.now() };
    setStatus({ seconds: 0, bytes: 44 });
    timer.current = setInterval(() => {
      const current = active.current;
      if (!current) return;
      const elapsed = Date.now() - current.started;
      if (elapsed >= RECORDING_LIMIT_MS) { stop(); return; }
      setStatus({ seconds: Math.floor(elapsed / 1000), bytes: current.wav.size });
    }, 250);
  };
  const append = (pcm: Uint8Array, sampleRate: number) => {
    const current = active.current;
    if (!current) return;
    if (Math.round(sampleRate) !== current.wav.sampleRate || Date.now() - current.started >= RECORDING_LIMIT_MS) {
      stop();
      return;
    }
    current.wav.append(pcm);
    if (current.wav.full) stop();
  };
  useEffect(() => () => stop(), [stop]);
  return { status, start, stop, append };
}
