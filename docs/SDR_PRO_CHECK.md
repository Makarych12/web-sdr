# SDR PRO — local stage, 2026-10-22

Only SDR PRO added. CLASSIC/MALAHIT DSP algorithms and controls preserved. No publication, push, dependencies, protocol, audio or other feature changes.

## Algorithm

`src/sdrPro.ts` implements a separate whole-row adaptive exposure. A 256-bin histogram measures the 20th percentile background and 99.5th percentile upper energy. Display range tracks their separation plus 8dB, bounded to 32–96dB. Floor follows at .08 per actual FFT row; range expands at .35 and contracts at .04, avoiding rapid exposure pumping. Exposure is computed causally from original accepted rows regardless of selected visualization, stored with each row, reset for a different source view/calibration, and reused when switching modes.

Every source bin passes through a monotone exposure curve. The lower segment has adjustable contrast; the upper segment has an exponential soft knee so stronger energy retains headroom. No averaging or filtering across frequency, no local background subtraction and no temporal mark gate: broad emission envelopes and isolated narrow lines keep their original bins. Existing COLOR LUT is applied afterward. This differs from both CLASSIC's fixed range and MALAHIT's local/temporal background separation; equal input byte values can have different exposure in different rows, but ordering within each row is preserved.

SDR PRO has independent contrast .5–2.5 (default1.1) and sensitivity -12…+18dB (default0). They persist as optional proContrast/proSensitivity fields in the existing display settings key. Prior saved CLASSIC/MALAHIT settings remain valid and retain their values. No 3D mode or placeholder added.

Only SDR PRO splits the existing 2px scroll into two integer 1px positions per actual incoming FFT row. The second step is scheduled once, at half the measured row cadence (bounded16–80ms). Images are never blended or interpolated; no additional FFT values or historical measurement rows are generated. With no new data the final step settles and stops. Mode change, hide, clear and dispose cancel the motion timer. CLASSIC and MALAHIT retain their prior scroll/render path. The original FFT width still limits visible detail; software cannot add RF resolution.

## Five targeted checks

1. **Legacy renderer regression on real capture:** pre-stage renderer snapshot vs new renderer, same real Niendorf FFT input. CLASSIC and MALAHIT each byte-exact. Source row references/bytes, views and RF spectrum preserved. SDR PRO differs and both own controls affect rendering. Replay artifacts: replay.json and replay.mjs.
2. **Real-data shape/exposure check:** 240 unique rows / 1024 bins captured from live Kiwi. Within-row amplitude ordering violations0; newly introduced strict local maxima0; equal input values within a row map equally. Hence no artificial RF peak positions or frequency smoothing. Adaptive display range32–39.2311dB. 41 source magnitudes have context-dependent exposure across history, so this is not a replacement static LUT. Maximum default mapped byte235 (below the upper cap). Source modulation of each observed structure was not independently verified; this check establishes preservation of real broad/narrow structures rather than a station/transmission classification. Data: real-history.json, data-check.json, data-check.mts.
3. **Live comparison and performance:** real Niendorf Kiwi, VFO7110.000kHz LSB, view7016.404867172241–7133.592367172241kHz, zoom8. Filled480 history scanlines. For the three screenshots, paused only renderer intake temporarily, retained the same real history and palette CLASSIC, switched modes through the actual UI and waited for bounded repaint completion. No image synthesis or dummy signals. Radio/audio stayed connected. Visually inspected all three screenshots and the control panel. Resumed live SDR PRO afterward: two integer scroll phases observed for the same source sequence; 184 motion frames recorded, no fractional offset or intensity interpolation. Geometry, frequency, raw history, source view and spectrum unchanged by switches. Connection count3→3, tune/view command count2→2; PCM451→716, sequence451→715. Output finite/nonzero; underrun0→0. Render p99 4.1ms, immediate display-update calls2.0–4.9ms; historical repaint remains in bounded batches. No browser page errors. This is not a subjective audio listening assessment or a guarantee against network stalls.
4. **Persistence/mobile:** desktop reload restored SDR PRO and own contrast; mobile390px selector fits all three choices, own sensitivity change persists across reload, invalid settings fall back safely. Legacy MALAHIT values remain contrast1.2 / brightness-6 / range45 in the test after adjusting SDR PRO controls. Mobile screenshot is an isolated UI test, not a fabricated receiver session.
5. **TypeScript/production build/source scope:** tsc and Vite build pass, git diff --check clean. Only src/sdrPro.ts, src/spectrumRenderer.ts (new branch, exposure metadata and SDR-only scroll), src/waterfallMode.ts (optional settings/validation), src/WaterfallMode.tsx (third choice/own controls), and this report changed. No mass suite or dependency installation. KiwiProtocol, WebSocket, audio, dials, CW/DSP and other features untouched.

## Screenshots — same genuine FFT history, same palette, VFO7110kHz

CLASSIC:

![CLASSIC](../artifacts/sdr-pro/classic-live.png)

MALAHIT DSP:

![MALAHIT DSP](../artifacts/sdr-pro/malahit-live.png)

SDR PRO:

![SDR PRO](../artifacts/sdr-pro/sdr-pro-live.png)

Artifacts/harnesses are local in artifacts/sdr-pro: before-renderer.ts, replay.mjs/json, live.mjs/json, real-history.json, data-check.mts/json, mobile.mjs/json, controls.png, mobile-controls.png. They are not bundled into the website. No commit or deployment created.
