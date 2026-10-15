import test from "node:test";
import assert from "node:assert/strict";
import { RadioMedia } from "../src/radioMedia.ts";

class AudioElement extends EventTarget {
  srcObject: unknown = null;
  src = "";
  paused = true;
  plays = 0;
  preload = "";
  setAttribute() {}
  async play() {
    this.paused = false;
    this.plays++;
    this.dispatchEvent(new Event("playing"));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}
test("persistent audio element carries only the real PCM stream and is reused on recovery", async () => {
  const audio = new AudioElement();
  const handlers = new Map();
  const session = {
    playbackState: "none",
    metadata: null,
    setActionHandler: (a: string, h: unknown) => handlers.set(a, h),
  };
  const media = new RadioMedia(
    audio as unknown as HTMLAudioElement,
    session as unknown as MediaSession,
  );
  let stopped = 0,
    disconnected = 0;
  const output = {
    stream: { getTracks: () => [{ stop: () => stopped++ }] },
    disconnect: () => disconnected++,
  };
  const connections: unknown[] = [];
  const context = { createMediaStreamDestination: () => output };
  const source = { connect: (node: unknown) => connections.push(node) };
  media.attach(
    context as unknown as AudioContext,
    source as unknown as AudioNode,
  );
  assert.equal(audio.srcObject, output.stream);
  assert.deepEqual(connections, [output]);
  assert.equal(audio.src, "", "no silent file, data URL or alternate source");
  let plays = 0,
    pauses = 0;
  media.actions(
    () => plays++,
    () => pauses++,
  );
  handlers.get("play")();
  handlers.get("pause")();
  handlers.get("stop")();
  assert.equal(plays, 1);
  assert.equal(pauses, 2);
  await media.play();
  assert.equal(session.playbackState, "playing");
  media.pause();
  assert.equal(session.playbackState, "paused");
  await media.play();
  assert.equal(media.audio, audio);
  assert.equal(audio.plays, 2);
  assert.equal(audio.srcObject, output.stream);
  media.dispose();
  assert.equal(stopped, 1);
  assert.equal(disconnected, 1);
  assert.equal(audio.srcObject, null);
  assert.equal(session.playbackState, "none");
  assert.deepEqual([...handlers.values()], [null, null, null]);
});
test("media metadata includes station, receiver, exact RF frequency and mode", () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "MediaMetadata");
  Object.defineProperty(globalThis, "MediaMetadata", {
    configurable: true,
    value: class {
      constructor(data: object) {
        Object.assign(this, data);
      }
    },
  });
  try {
    const session = { metadata: null, setActionHandler() {} };
    const media = new RadioMedia(
      new AudioElement() as unknown as HTMLAudioElement,
      session as unknown as MediaSession,
    );
    media.metadata("Niendorf", 14200251, "USB");
    assert.equal((session.metadata as any).title, "UR4MTN WEB SDR");
    assert.equal((session.metadata as any).artist, "Niendorf");
    assert.equal((session.metadata as any).album, "14.200251 MHz · USB");
    media.dispose();
  } finally {
    if (old) Object.defineProperty(globalThis, "MediaMetadata", old);
    else Reflect.deleteProperty(globalThis, "MediaMetadata");
  }
});
