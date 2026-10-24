/** Resample real Kiwi dB bins on one frequency grid for both canvases.
 * Upsampling is linear in dB (no spline overshoot). Downsampling keeps the
 * strongest measured bin in each pixel footprint, so narrow carriers survive.
 * Bin i remains at start + i * span / N, including when the view is projected.
 */
export function resampleFft(bins: ArrayLike<number>, width: number) {
  const result = new Float32Array(width);
  const scale = bins.length / width;
  for (let x = 0; x < width; x++) {
    const position = x * scale;
    const left = Math.min(bins.length - 1, Math.floor(position));
    const fraction = position - left;
    let value = bins[left] + fraction * (bins[Math.min(left + 1, bins.length - 1)] - bins[left]);
    if (scale > 1) {
      for (let i = Math.ceil(position); i < Math.min(bins.length, (x + 1) * scale); i++)
        value = Math.max(value, bins[i]);
    }
    result[x] = value;
  }
  return result;
}
export function displayLevels(noiseDb: number, refLevel = -40, rangeDb = 60, autoLevel = true) {
  const topDb = autoLevel ? noiseDb - 8 + rangeDb : refLevel;
  return { topDb, blackDb: topDb - rangeDb, rangeDb };
}
/** Bounded backing store: Android DPR 3–4 must not multiply FFT work by 9–16. */
export function spectrumCanvasSize(width: number, height: number, dpr: number) {
  const ratio = Math.min(2, Math.max(1, dpr), 2048 / Math.max(1, width));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)), ratio };
}
