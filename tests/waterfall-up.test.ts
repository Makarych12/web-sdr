import test from "node:test";
import assert from "node:assert/strict";
import { SpectrumRenderer } from "../src/spectrumRenderer.ts";

test("new rows enter at the bottom, history moves up, bursts drain on RAF and idle stops", () => {
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  class Canvas {
    width = 8;
    height = 8;
    dataset: Record<string, string> = {};
    buffer = new Uint8ClampedArray(8 * 8 * 4);
    uploads = 0;
    context = {
      fillStyle: "", globalAlpha: 1, globalCompositeOperation: "", imageSmoothingEnabled: false,
      fillRect: () => { this.buffer = new Uint8ClampedArray(this.width * this.height * 4); },
      clearRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: ImageData, x: number, y: number) => {
        this.uploads++;
        this.buffer.set(image.data, (y * this.width + x) * 4);
      },
      drawImage: (source: Canvas, sx: number, sy: number, sw: number, sh: number,
        dx: number, dy: number, dw: number, dh: number) => {
        const original = source.buffer.slice();
        for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
          const from = ((sy + Math.floor(y * sh / dh)) * source.width + sx + Math.floor(x * sw / dw)) * 4;
          this.buffer.set(original.subarray(from, from + 4), ((dy + y) * this.width + dx + x) * 4);
        }
      },
    };
    getContext() { return this.context; }
    pixel(y: number) { return Array.from(this.buffer.slice(y * this.width * 4, y * this.width * 4 + 4)); }
  }
  Object.assign(globalThis, {
    document: { visibilityState: "visible", createElement: () => new Canvas() },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    Path2D: class { moveTo() {} lineTo() {} closePath() {} },
  });
  const flush = () => {
    const batch = [...frames.values()]; frames.clear(); batch.forEach((callback) => callback(0));
  };
  try {
    const spectrum = new Canvas(), waterfall = new Canvas();
    const view = { start: 7000, span: 100 };
    const renderer = new SpectrumRenderer(spectrum as unknown as HTMLCanvasElement,
      waterfall as unknown as HTMLCanvasElement, view);
    flush();
    renderer.append(new Uint8Array(1024).fill(100), { ...view, sequence: 1 }); flush();
    const first = waterfall.pixel(7);
    assert.notDeepEqual(first, [0, 0, 0, 0]);
    assert.deepEqual(waterfall.pixel(0), [0, 0, 0, 0]);
    assert.equal((renderer as any).history.uploads, 1, "one canvas upload per packet, including repeated backing rows");
    const repeatedStrip = (renderer as any).repeatedStrip;
    renderer.append(new Uint8Array(1024).fill(220), { ...view, sequence: 2 }); flush();
    assert.equal((renderer as any).repeatedStrip, repeatedStrip, "reuse the packet upload buffer");
    assert.deepEqual(waterfall.pixel(5), first, "previous bottom row moves upward by two pixels");
    assert.notDeepEqual(waterfall.pixel(7), first, "new signal is at bottom");
    renderer.append(new Uint8Array(1024).fill(180), { ...view, sequence: 3 });
    renderer.append(new Uint8Array(1024).fill(240), { ...view, sequence: 4 });
    flush(); assert.equal(waterfall.dataset.rows, "6");
    assert.equal(frames.size, 1, "burst schedules its next row");
    flush(); assert.equal(waterfall.dataset.rows, "8");
    assert.equal(frames.size, 0, "no idle animation consumes CPU");
    const zoomed = { start: 7025, span: 50 };
    renderer.setView(zoomed); flush();
    assert.equal(waterfall.dataset.rows, "0", "zoom discards coarse raster history");
    assert.equal(renderer.append(new Uint8Array(1024).fill(200), { ...view, sequence: 5 }), false,
      "old span cannot paint under the new frequency scale");
    assert.equal(renderer.append(new Uint8Array(1024).fill(200), { ...zoomed, sequence: 6 }), true);
    flush();
    assert.equal(waterfall.dataset.rows, "2");
    renderer.setView({ start: 7026, span: 50 }); flush();
    assert.equal(waterfall.dataset.rows, "2", "same-span pan keeps real history");
    for (let sequence = 7; sequence < 87; sequence++) {
      renderer.append(new Uint8Array(1024).fill(sequence), { start: 7026, span: 50, sequence });
      flush();
    }
    assert.equal((renderer as any).colorRows.length, waterfall.height, "history is bounded by canvas height");
    assert.equal((renderer as any).rowViews.length, waterfall.height);
    renderer.setVisible(false);
    assert.equal(frames.size, 0, "hidden waterfall has no RAF");
    assert.equal(renderer.append(new Uint8Array(1024), { start: 7026, span: 50 }), false);
    renderer.setVisible(true); flush();
    renderer.clear(); flush();
    assert.equal((renderer as any).colorRows.length, 0, "server reset releases stored rows");
    assert.equal((renderer as any).pending.length, 0);
    renderer.dispose(); assert.equal(frames.size, 0, "dispose cancels rendering");
  } finally {
    for (const key of ["document", "requestAnimationFrame", "cancelAnimationFrame", "Path2D"]) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
