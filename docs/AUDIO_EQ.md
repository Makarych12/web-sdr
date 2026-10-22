> Current local corrections and measurements: [DX_EQ_COLOR_CHECK.md](DX_EQ_COLOR_CHECK.md). Earlier measurements below describe the previous implementation.

# AUDIO EQ — 2026-10-22

Playback path: existing PCM player → existing NR → existing NOTCH → new AudioEq → existing volume → existing media output. AudioEq uses real Web Audio BiquadFilterNodes: low shelf at 250 Hz, peaking at 1250 Hz (Q=.8), high shelf at 3000 Hz. Band gains are -12…+12 dB. The dry path bypasses every biquad. ON/OFF crossfades over 50 ms; coefficient changes ramp over 40 ms, with headroom established first. Once OFF settles, the EQ input branch is disconnected. Suspended contexts resume in exact dry bypass when OFF.

Headroom is automatic, not loudness normalization: non-flat settings use preamp = -(sum of positive band gains + 6) dB. FLAT is unity. This deliberately reduces playback level when EQ is active to protect peaks. It does not guarantee arbitrary already-clipped inputs or every possible transient will be repaired.

Presets (BASS/MID/TREBLE dB): FLAT 0/0/0; VOICE -6/0/-3; DX -9/+2/-6; MUSIC +2/-1/+2. VOICE/DX shape bass and hiss relative to the voice midrange; no intelligibility improvement is claimed. Settings persist at `ur4mtn.audio-eq.v1`; default OFF/FLAT. The compact EQ launcher is absolutely positioned without changing existing control layout. Preset selection preserves ON/OFF state.

REC's existing raw PCM callback and AF-FFT's existing raw callback/analyser taps are unchanged and upstream of EQ. AF-FFT retains its existing pre/post-NR+NOTCH display; neither trace receives EQ output. No modifications to KiwiProtocol, WebSocket, PCM player, NR, NOTCH, SCAN, REC, AF-FFT implementation, MEM, BAND PLAN, LOGBOOK or waterfall/dials.

## Five focused checks

1. TypeScript + Vite production build.
2. Real Chromium OfflineAudioContext rendering of tones for each band at +/-12 dB and comparison against native getFrequencyResponse (<.03 dB error). Relative to the compensated preamp: BASS +/-11.83 dB at 80 Hz; MID +/-12.00 at 1250 Hz; TREBLE +/-11.22 at 6000 Hz. Shelves approach +/-12 asymptotically. OFF and FLAT max sample error = 0. Turning EQ OFF during rendering also restores sample-exact bypass after the fade.
3. Full-scale (.99) noise, alternating steps and sine through three stress settings (+12/+12/+12, -12/+12/-12, +12/-12/+12). No nonfinite output or samples above full scale. Maximum steady EQ peak .470267; ON transition peak .99000001 including the original dry segment. Transition is tested for finite output/headroom, not subjective click audibility.
4. Same 105.7368 s LSB source for all four presets: `/home/maks/Рабочий стол/UR4MTN_7143149Hz_LSB_2026-10-21_19-32-55.wav`, previously resampled from 11999 to 48000 Hz in the test fixture. Isolated EQ test (NR/NOTCH not rerun or altered). Raw peaks: FLAT .451082, VOICE .222826, DX .204372, MUSIC .145231, no clipping/nonfinite output. Constant-gain matching produces WAVs at -23.00/-23.00/-23.01/-23.00/-23.00 LUFS for original/FLAT/VOICE/DX/MUSIC; true peaks -10.88/-10.88/-10.56/-10.06/-10.45 dBTP. No limiter or dynamic compressor used. This is signal-level verification, not listening or an SNR score.
5. Browser UI desktop 1440px and mobile 390px: presets, range change, OFF, persistence across reload, no horizontal panel overflow or page errors; existing tuner/steps/mode/scale/dial/waterfall/LOG/NR/NOTCH positions unchanged when EQ launcher is hidden/shown. Mobile screenshot inspected. No live receiver connection is claimed.

Subjective listening of words, consonants, endings and natural voice was NOT performed by the agent. Speech quality and intelligibility remain unconfirmed. The loudness-matched WAVs are supplied for human comparison; matching integrated BS.1770 loudness is not identical to matching subjective speech loudness.

Artifacts: `artifacts/audio-eq/results.json`, `listening-levels.json`, `original-matched.wav`, `flat-matched.wav`, `voice-matched.wav`, `dx-matched.wav`, `music-matched.wav`, screenshots. Reproducible DSP/UI check: `tests/audio-eq-browser.mjs` using a local Vite server and existing installed Chrome, with `artifacts/dsp/ssb-input.f32` as the source fixture. WAV preparation script is in artifacts/audio-eq/prepare-listening.py and uses the existing ffmpeg binary.

Changes in this stage: new audioEq.ts, AudioEqControls.tsx, audio-eq.css, integration only in main.tsx, targeted test and this report. Previous uncommitted BAND PLAN and LOGBOOK work retained. No dependencies, automatic recording, push or deployment.
