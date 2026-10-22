# WATERFALL MODE — MALAHIT DSP stage, local verification 2026-10-22

Only CLASSIC and MALAHIT DSP are available in this stage. SDR PRO and 3D SPECTRUM are not implemented, offered as placeholders or started. No publication, commit, dependencies or architecture rewrite. Earlier uncommitted spectrum/CW/palette work is retained.

## Renderer inspection and implementation

The previous renderer drew each row by a one-dimensional calibrated byte → color LUT. Switching its six themes only changed that table. Raw source bins and original per-row level normalization were already retained for historical recoloring.

CLASSIC still calls its original paintColorRow unchanged. MALAHIT DSP has a separate display-data algorithm before color lookup:

1. A sliding 33-bin histogram yields a local low percentile (12th sample), blended with the original robust row noise floor. Local adjustment is bounded to ±2.8dB to avoid erasing broad real emissions.
2. The current bin's excess above this local background is measured. The same RF bin in the preceding real FFT row supplies continuity evidence, only when source views match. Uncorrelated grain receives less display weight. A new mark still appears on its first packet. The previous row can never produce a pixel after the current bin falls below threshold; there is no trail extension or frequency relocation.
3. Logarithmic dynamic compression and adjustable contrast/brightness map that display measurement to the existing chosen color table. No random samples, generated signals, ridge drawing, colored overlays or interpolation of new RF peaks.

Thus equal raw magnitudes can render differently according to neighboring frequency/time measurements; the result cannot be represented by replacing one byte → color LUT. The screenshot pair deliberately uses the same CLASSIC color theme.

WATERFALL MODE opens a compact two-mode panel, with contrast .5–2.5, brightness -30…+30%, and a 25–100dB ceiling above the estimated background. Defaults for MALAHIT: 1.2 / -6% / 45dB. Controls are disabled in CLASSIC to preserve the old view. Display mode/settings persist under `ur4mtn.waterfall-display.v1`. COLOR remains an independent palette selector. Only the two new floating controls' own content is added; existing geometry is unchanged.

The existing bounded history and scrolling path are reused. Source bins, views, timing and sequence remain intact. Switching modes rerenders retained measurements; new incoming rows immediately use the selected algorithm. History redraw is processed in approximately 2ms main-thread batches across animation frames. This avoids a full synchronous redraw blocking PCM dispatch. Partial historical redraw may be visible briefly; it is not a new FFT or a change in scroll speed. Pending repaints are canceled/replaced on settings changes and canceled on clear/dispose.

## Five targeted checks

1. **Renderer/source audit:** established the old LUT-only path before editing. Spectrum, FFT transport and audio remain outside the new display processing. CLASSIC's row paint implementation is unchanged.
2. **Controlled real-data replay:** used genuine Niendorf W/F capture from the earlier local test, not generated FFT. Original renderer snapshot and new CLASSIC render 50 historical scanlines byte-exactly. MALAHIT differs; returning CLASSIC restores exact pixels. Raw row references/bytes, historical views and spectrum remain unchanged. Equal source byte values produce distinct outputs according to context, demonstrating that MALAHIT is not a LUT substitution. Contrast, brightness and range each affect the rendered measurement. Results in replay.json.
3. **Live KiwiSDR and controlled screenshot pair:** Niendorf, VFO 7020.000kHz, CW, zoom10, span 29.296875kHz. Filled 480 history scanlines from real W/F. To compare identical data, the test temporarily paused only renderer intake, kept radio/audio connected and active, and captured CLASSIC / MALAHIT after their redraws completed. The same frozen real history, calibration, palette and source view appear in both images. Intake resumed afterward; sequence advanced 645→917 in the final run. No synthetic/drawn signals were injected. All three sliders changed actual output; history references and spectrum were preserved. Frequency and element geometry unchanged; WebSocket/tune command counts unchanged. Both final images and desktop/mobile controls were visually inspected.
4. **Persistence/mobile:** reload restored MALAHIT DSP and adjusted settings; 390px panel fits, exposes only two modes, range change persists. Corrupted/out-of-range settings safely restore CLASSIC. No page errors. Mobile fixture verifies controls only, not an invented radio session.
5. **Audio/performance/build:** a first full synchronous 480-line redraw took 60–70ms and the capture showed an underrun; this was corrected before completion. Final bounded display-update calls measured 2.0–4.5ms; normal render p99 5.9ms on this host. Real output finite/nonzero before/after, PCM continued, underflowFrames remained 0→0 in the final run, with no reconnect or extra tuning commands. No subjective listening assessment or guarantee against unrelated network stalls. TypeScript and Vite production build pass; git diff --check clean. No mass suite.

## Limits

This is a custom Malahit-inspired contextual spectrogram, not a reproduction of undisclosed hardware firmware. Display background suppression does not improve RF/audio SNR or recover a transmitter below receiver noise/resolution. Some brief or weak marks will look dimmer due to the continuity weighting. Display range is relative to the estimated noise floor, not a newly calibrated absolute RSSI scale. The RF spectrum line, raw waterfall data, source rate, upward scroll direction, zoom and geometry are unchanged. 3D and SDR PRO require separate instructions.

## Stage files and artifacts

Production: src/waterfallMode.ts, src/WaterfallMode.tsx, src/waterfall-mode.css, src/spectrumRenderer.ts (mode dispatch/history repaint only), src/main.tsx (display settings/component integration). Report: docs/MALAHIT_MODE_CHECK.md. No edits in this stage to audio/player, KiwiProtocol/WebSocket, CW, NR, NOTCH, SCAN, REC, MEM, LOGBOOK, DX Cluster or palette definitions.

Local artifacts/harnesses: artifacts/malahit-mode/{replay.json,live.json,mobile.json,replay.mjs,live.mjs,mobile.mjs,controls.png,mobile-controls.png}. The before-renderer.ts snapshot preserves the exact local pre-stage renderer for comparison; screenshots and harnesses are not bundled into the app.

CLASSIC — same real history at 7020kHz:

![CLASSIC](../artifacts/malahit-mode/classic-live.png)

MALAHIT DSP — same history and same CLASSIC palette:

![MALAHIT DSP](../artifacts/malahit-mode/malahit-live.png)
