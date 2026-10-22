> Current local corrections and measurements: [DX_EQ_COLOR_CHECK.md](DX_EQ_COLOR_CHECK.md). Earlier measurements below describe the previous implementation.

# DX CLUSTER — 2026-10-22

## Source verified before implementation

HamQTH public API v2: https://www.hamqth.com/api/v2/spots?limit=200
Developer terms/guide: https://www.hamqth.com/developers
Schema: https://www.hamqth.com/api/v2/openapi.json

The documented spots endpoint requires no login/key or payment and permits browser access (CORS *). API usage requires visible HamQTH attribution and invitation to maintain a profile; both are included in the panel. The spots limit is 1–200. The developer guide's legacy feed guidance says not to refresh faster than 10 seconds, with underlying DXSpider updates about every 15 seconds. This implementation polls at 60 seconds, only after first opening DX and only while the page is visible. No post, spotting submission, cluster telnet login or scraping is used.

Pre-implementation real probe returned HTTP 200, CORS *, structured JSON with live UTC timestamps. Format is `{ spots: [...] }`: dxcall and spotter strings, freq numeric kHz, time ISO-8601 UTC. No MHz guessing, local-time inference or invented source fields. Browser CORS access was independently confirmed in the first end-to-end run. Captures are artifacts/dx-cluster/live-source.json and browser-live.json; no fixture data ships in src/public or is loaded as a production fallback.

## Implemented

- Compact DX launcher in otherwise unused bottom border of the control panel, modal panel of recent callsign/frequency/UTC/provider/spotter records.
- A filter for the current HF amateur band. Filtering is local and does not issue extra API requests. Band envelopes are for cluster filtering, not a mode plan or national licence table; BAND PLAN is unchanged.
- Separate DOM overlays above the existing spectrum and waterfall canvases, using the same `view.start`/`view.span`. No renderer/canvas history or DSP change. Labels track resize/zoom/pan, use three collision-checked lanes and at most twelve labels per overlay. Duplicate call/frequency labels collapse to the newest report. The full filtered panel still contains reports whose labels do not fit.
- Panel and overlay clicks call existing tuning, preserving current demodulation mode. Range checks exist in both UI and main callback: known receiver min/max, application 30 MHz limit and current receiver bandwidth. Unknown receiver metadata disables tuning. This is coverage checking, not a guarantee a receiver is online or a station is audible.
- Ten-second request timeout, no overlapping requests, memory-only data, no automatic logging. Normal refresh 60 s after completion. Failure retry backs off to 120/240/300 s; readable Retry-After can extend it. A browser cannot read a cross-origin Retry-After header unless the provider exposes it via CORS. Hidden tabs do not initiate requests. API errors remain local to DX; markers are suppressed and the panel clearly labels retained data as the last received state.
- Time-based freshness: source timestamp is never replaced with fetch time; only reports within 30 minutes and at most one minute into the future are displayed. Aging runs every 15 seconds while visible, including when SDR playback is stopped.

## Five focused checks

1. Real provider/API/schema/terms/CORS probe before coding. Sample data saved, authentication not used.
2. TypeScript + Vite production build passed.
3. One targeted model test using only captured real source records: exact kHz/UTC parsing, 30-minute expiry, band filter, allowed/blocked receiver range, zoom projection, offscreen suppression, duplicate label collapse and malformed format handling. No invented stations in tests.
4. Browser end-to-end: real direct HamQTH request returned 200/CORS *; 109 usable fresh HF records in that capture; panel and current-band filter, real A92AE 28074 kHz selection and overlay click set VFO to 28074000 Hz, existing USB mode preserved. Coordinate checks before/after a 2x zoom and overlays on both canvases passed. One source request despite filter/zoom interactions. Mobile 390px panel has no horizontal overflow and existing control/scale/waterfall/dial layout positions stay unchanged when launcher is hidden/shown. Screenshots inspected. The live portion passed on the initial run; full deterministic reruns reused that exact captured response while the layout harness was corrected for ongoing page animation. No additional upstream traffic was needed for those reruns.
5. Separate isolated error/timing test uses HTTP 503 and a readable Retry-After=180 response, then the same real captured records: understandable error, zero error-state labels, unchanged VFO, no early retry, recovery, 60-second normal interval, no requests during 180 seconds hidden, one refresh on return. Timers are virtual; simulated requests never hit HamQTH. No page errors.

## Limits and scope

Only the latest 200 source messages are downloaded, only HF bands through 30 MHz are retained, and reports older than 30 minutes are omitted. This is not a complete worldwide cluster archive; quiet bands may have no records within the last 200. Spots are third-party reports, not proof the local SDR can hear them. All visible reports come from HamQTH; no demonstrations or offline station fallback exist. Provider availability, CORS and network filtering remain external dependencies. Once activated, the feed remains enabled until reload; closing its panel leaves the markers active. Polling is per active visible browser tab, with no shared server cache.

No live receiver/audio session was started for this stage's browser checks; VFO state and coverage guards were verified. Existing audio, protocol, WebSocket, NR/NOTCH/EQ, SCAN/REC/MEM, LOGBOOK and BAND PLAN modules were not edited. Existing uncommitted work from those stages was retained. No dependencies installed, push or deployment.

Files this stage: src/dxCluster.ts, src/useDxCluster.ts, src/DxCluster.tsx, src/dx-cluster.css, import/hook/component/overlay integration in src/main.tsx; tests/dx-cluster.test.ts and tests/dx-cluster-browser.mjs. Test artifacts and captures: artifacts/dx-cluster/.
