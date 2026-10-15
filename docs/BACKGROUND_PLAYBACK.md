# Direct Kiwi and background playback

The browser's direct `DirectKiwiSocket` / `KiwiProtocol` path has no 300-second session timer. The only session-duration setting is `api/gateway.js.maxDuration: 300` in Vercel configuration, which applies to the gateway function, not browser-to-Kiwi WSS. Receiver-imposed `tlimit`, access restrictions and real network interruptions remain outside the website's control.

Transport closes, gateway errors and stream stalls retry the selected receiver with the latest frequency, mode and cuts. Generic `connection` errors no longer trigger receiver failover. Automatic selection of a different receiver still requires repeated explicit Kiwi refusal (`badp`, `too_busy`, `down`); manual selection remains available. A catalog refresh cannot change an active receiver merely because it is missing from the returned list.

The existing PCM worklet and gain feed a `MediaStreamAudioDestinationNode` connected to one persistent `HTMLAudioElement.srcObject`. There is no additional direct-speaker path, silent file, oscillator or microphone permission. Media Session publishes UR4MTN WEB SDR, receiver name, exact frequency/mode, existing artwork and play/pause/stop handlers. Support and actual lock-screen presentation depend on the browser/OS.

`visibilitychange`, `freeze`, `resume` and `pageshow` preserve listening intent. Hiding/freezing does not stop audio or replace WSS. Background watchdogs require PCM rather than waterfall updates. Resume sends direct keepalives and allows five seconds for queued network events before replacing a stale open connection. A suspended AudioContext and paused media element resume together; an explicit user stop is not undone by lifecycle events.

## Verification and limits

- `npm test`: includes accelerated protocol coverage beyond 600 seconds, gateway retry with exact 14.200251 MHz USB and custom cuts, stale/fresh resume, real-stream routing, Media Session actions and metadata.
- `node tests/background-audio.mjs`: short live Kiwi test with desktop Chromium, real PCM through the audio element, simulated hidden state, a short Chromium freeze, forced AudioContext suspension, actual WSS interruption, same-receiver restoration and Media Session actions. Report: ignored `artifacts/background-audio/report.json`; production URL can be supplied with `TEST_APP_URL`.
- These are automated desktop checks, **not** a physical Android lock-screen test. No Android device is connected in this environment, so 5 minutes screen-off plus 5 minutes in another Android app and actual lock-screen controls cannot be certified here. No hour-long soak is used.

A regular website cannot guarantee playback after Android freezes/discards its page or kills the browser process. Persistent media playback and Media Session improve integration but do not grant an Android foreground service. Guaranteed native background operation requires an Android application with a media-playback foreground service (`MediaSessionService`) that owns the receiver connection and audio pipeline; a WebView wrapper alone is insufficient.

References: [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [Android background playback with MediaSessionService](https://developer.android.com/media/media3/session/background-playback).
