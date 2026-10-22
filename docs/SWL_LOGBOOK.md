# DX LOGBOOK · SWL (2026-10-22)

LOG opens a compact modal. Its launcher is absolutely positioned next to the existing top-edge controls, so it does not move other controls. ADD is the only way to create observations: it captures the current VFO frequency/mode and UTC at submission, with a user-entered call, optional observed RST, and comment. No automatic logging or recording. Entries may be edited/deleted/searched by callsign. Clicking a stored frequency invokes the existing tuning function with that entry's frequency and mode.

Persistence uses the separate `ur4mtn.swl-log.v1` localStorage key. Memory Bank data is not read or modified. Writes occur before updating the list. A quota/storage failure keeps the old entries and the unsaved form, and reports failure. Invalid stored data is not overwritten. Browser storage clearing, private-session limitations, or external manual removal of localStorage can still remove the log.

Exports include all journal entries, independent of the search filter:
- ADIF 3.1.8 in UTF-8 ADX (.adx), preserving Cyrillic: CALL, FREQ in MHz to 1 Hz, MODE, optional SUBMODE (USB/LSB under SSB), QSO_DATE and TIME_ON in UTC, SWL=Y, QSO_COMPLETE=N, COMMENT_INTL. Observed RST is in the application-defined UR4MTN/SWL_RST field and a readable comment, not RST_SENT or RST_RCVD, since no two-way report was exchanged. Programs supporting only legacy .adi may not import .adx.
- UTF-8 BOM CSV, quoted fields, CRLF record separators: CALL,FREQ_MHZ,MODE,DATE_UTC,TIME_UTC,SWL_RST,COMMENT,SWL. Quotes and multiline Unicode comments are preserved.

Specification: https://adif.org.uk/318/ADIF_318.htm (ADX structure, SWL, application-defined fields and SSB submodes).

Five focused check scenarios, no mass suite:
1. Production TypeScript/Vite build.
2. Storage round-trip, edits/deletion, corrupt records, duplicate IDs, invalid date and failed writes (`tests/swl-logbook.test.ts`).
3. Export fields, SWL semantics, exact MHz/UTC and Unicode quoting; independent Python XML/CSV parsing of fixtures and actual browser downloads.
4. Desktop 1440px workflow: no automatic entry on open; ADD captures 7143.149 kHz LSB and exact UTC while browser timezone is Sofia; reload persistence; case-insensitive search; edit call/frequency/mode/RST/UTC; downloaded ADX and CSV; click tunes VFO to 14074.125 kHz USB; quota failure preserves entries; deletion survives reload. Layout positions unchanged when launcher is hidden/shown. No page errors.
5. Same workflow at 390px, no horizontal modal overflow. Screenshot visually inspected.

Browser fixtures are isolated and do not populate a user's journal. Tests use local Vite UI without starting radio playback; actual RF/network delivery is not claimed. Artifacts: `artifacts/swl-logbook/browser-results.json`, downloaded exports, fixture files and screenshots.

Only new logbook modules/styles, the component import and its integration in main.tsx were changed this stage. Existing uncommitted BAND PLAN work was retained. No changes to protocol, WebSocket, audio, DSP, scanning, recording, AF-FFT, BAND PLAN, Memory Bank, waterfall or dials. No dependencies installed; no push/deployment.
