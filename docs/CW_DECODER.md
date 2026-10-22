# CW DECODER — 2026-10-22

## Implementation and scope

CW DEC opens a compact modal; processing starts only with its ON button. The decoder reads the same existing demodulated mono Float32 PCM immediately before the original AF/scanner consumers and PCM-player buffer transfer. It never writes to or retains the PCM array. No second SDR connection, microphone, AudioContext, audio node, Worklet or dependency is created.

New CwDecoder uses quadrature detection at the selected 300–1000 Hz tone, two-stage 45 Hz low-pass integration and adjacent-tone guards +/-160 Hz. It evaluates the envelope in 5 ms frames, tracks a rolling noise floor, uses hysteresis and a two-frame debounce, classifies keyed marks/gaps and maps standard Morse symbols to characters. AUTO estimates a 5–40 WPM timing unit from recent mark/gap durations; manual mode uses the selected speed. A small envelope timing compensation reduces hysteresis bias. Unknown patterns and some unreliable continuations are marked with replacement characters; isolated low-confidence noise bursts are suppressed. No transcript template, dictionary completion or callsign guessing exists in production code.

The confidence display is a heuristic signal/rhythm score (0–100), not calibrated character correctness. AUTO needs acquisition marks; leading characters can be wrong or missed. Tone selection is manual, not an automatic search for every station. Only one selected tone is decoded. Text is bounded to the last 12000 characters, scrolls, and COPY uses the browser clipboard API. Changing tone/speed, retuning, source reset or leaving the live state invalidates unfinished timing instead of combining stations. Closing the panel or OFF immediately sets the PCM consumer reference to null and clears the enabled-only UI polling interval. No decoder worker or DSP timer remains active OFF.

The new launcher sits in unused control-panel border space beside DX. Existing elements do not move. No changes to KiwiProtocol, WebSocket, PCM player, audio, NR/NOTCH/EQ, REC/SCAN/MEM, LOGBOOK, DX CLUSTER, BAND PLAN or waterfall renderer were made. Previous stages' uncommitted files were retained unchanged this stage.

## Five focused checks

1. TypeScript/Vite production build.
2. One timing/noise test: synthetic PCM with a known explicitly test-only transcript at manual 5/20/40 WPM, AUTO acquisition at the same endpoints/midpoint, pauses, silence and deterministic broadband noise. Manual target text decoded at all three speeds. AUTO estimates 5/21/40 WPM respectively; acquisition-prefix errors are present and are not hidden. After acquisition the requested test phrase decodes. Noise and silence produced no text in these fixtures. This is a controlled timing check, not evidence of on-air accuracy.
3. Real off-air 40m CW: 181.035 s, tone near 410 Hz. AUTO finished around 26 WPM and repeatedly emitted WB3DOM plus fragments of exchanges. Gaps and uncertain portions remain. No human-verified transcript exists here; CER/WER and callsign correctness are NOT established. On this host the p99 processing time was about .38 ms per 512-sample input packet (42.67 ms of 12kHz audio). This is not a guarantee of browser/audio deadlines on other devices.
4. Real weak off-air 20m CW: 60.604 s, tone near 615 Hz. AUTO finished around 27 WPM; output remained fragmented (e.g. replacement symbols and short letter groups). Manual 20/30 WPM did not produce a reliable transcript. Weak-signal decoding is NOT validated as accurate. Appended 3-second zero-PCM pauses on both real recordings reduced confidence to zero; an additional 3 seconds produced no new text. This appended silence is a separate pause probe, not a claim that a naturally quiet interval was manually labeled. The original files themselves were not replaced with generated Morse.
5. Browser desktop 1440px/mobile 390px: real PCM drives the actual panel via an isolated consumer reference, without a fabricated SDR connection; displayed text equals decoder output, COPY matches it exactly, OFF reference is null and further feed attempts do nothing, manual speed/tone work, close stops processing, scroll/width fit verified. Existing tuner/scale/waterfall/dial/DX/EQ/LOG layout offsets unchanged when launcher is hidden/shown. No page errors; screenshot inspected. The production PCM dispatch and reset hooks were inspected directly, but a live RF/WebSocket session was not opened.

## Real recording provenance

The user had no local CW recording. Two publicly accessible author-posted receiver recordings were downloaded for local verification only:
- https://archive.org/download/ic-705-cw-40-mb-a/IC-705%20CW%2040MB%20A.mp3
- https://archive.org/download/RadioBSSBCY0Pileup/RadioA-Very-Weak-CW-20MB.mp3
Context: https://swling.com/blog/tag/kx3/ (off-air receiver comparisons including 40m CW and weak 20m CW). MP3s were converted to mono 12kHz Float32 with the already installed ffmpeg. Neither audio nor decoded text is bundled as app demo data.

Artifacts: artifacts/cw-decoder/sources.json, real-results.json, real-run.log, browser-results.json and screenshots. Tests: tests/cw-decoder.test.ts and tests/cw-decoder-browser.mjs; the real-record runner is artifacts/cw-decoder/real-check.mts. Reproduce browser check with a local Vite server and the two local fixtures.

## Limits

This is a basic single-tone decoder. It does not solve overlapping CW stations, deep fades, rapid drift, hand-keyed timing irregularity or severe QRM. Noise rejection can also suppress genuine weak marks. Neither reliable decoding of the weak recording nor general on-air accuracy is claimed. No subjective listening/transcription was performed by the agent. The ordinary recording yields useful repeated fragments, not a verified complete message. More ambitious weak-signal recovery would require a separate scope for timing/recovery improvements and reference transcripts; it was not added here.

No dependencies installed, automatic recording/logging, push or deployment. Files added: src/cwDecoder.ts, src/CwDecoderPanel.tsx, src/cw-decoder.css, tests/cw-decoder.test.ts, tests/cw-decoder-browser.mjs and this report. main.tsx contains only imports/reference, read-only PCM dispatch, reset handling and the panel component integration for this stage.
