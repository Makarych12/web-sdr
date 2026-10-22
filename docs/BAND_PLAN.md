# BAND PLAN — stage 1 (2026-10-22)

Read-only usage annotations inside the existing frequency scale. No new controls, dimensions, audio processing, recordings, protocol handling or dependencies. Existing scale gestures tune the actual VFO; clicking does not select a different demodulation mode. The new overlay stops duplicate native double-click propagation; the scale retains its existing touch gesture implementation.

Source: RSGB January 2026 tables, based on IARU Region 1:
https://rsgb.org/main/operating/band-plans/display/
https://rsgb.services/public/bandplans/7/ (160m), /8/ (80m), /10/ (40m), /11/ (30m), /12/ (20m), /13/ (17m), /14/ (15m), /15/ (12m), /16/ (10m).

Scope: nine principal HF bands, 160–10m. CW green, narrow/data purple, phone-compatible all-mode sections blue, mixed SSB/DATA striped. SSB is not an exclusive assignment. Beacon gaps remain uncolored; FM and satellite segments are not mislabeled as SSB. 60m is omitted because national allocations differ; LF/MF/VHF plans are not included. This is a Region 1 usage summary, not a worldwide or national licensing table. Colors describe recommended usage, not detected stations. Narrow sections retain their true width and expose their ranges/usage in tooltips; text is hidden where it cannot fit.

Five focused verification scenarios, no mass suite:
1. TypeScript + Vite production build passed.
2. Boundary/data check passed: 7040 kHz transition, 30m DATA, four reserved HF beacon gaps, 10m beacon gap, outside-band frequency.
3. View clipping/unit check passed: kHz-to-percent geometry, partial segments, empty/outside/invalid view, narrow zoom.
4. Desktop browser at 1440px: clicks selected 7025/7045/7100 kHz exactly, LSB preserved; keyboard tuning and zoom clipping passed; scale height unchanged at 46px; no page errors.
5. Touch browser at 390px: same frequencies/mode, keyboard and zoom checks passed; scale height unchanged at 46px; screenshot visually inspected.

Browser scenarios used local UI without starting radio playback. No live RF reception or WebSocket command validation is claimed. Artifacts: artifacts/band-plan/browser-results.json and 1440.png, 390.png. Reproduction: tests/band-plan.test.ts and tests/band-plan-browser.mjs (local Vite server, installed Chrome path).

No automatic recording, push or deployment. DX LOGBOOK, AUDIO EQ, DX CLUSTER and CW DECODER are not implemented in this stage.
