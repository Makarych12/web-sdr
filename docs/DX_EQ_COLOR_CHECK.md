# DX modes, EQ and waterfall themes — local verification 2026-10-22

This report supersedes earlier preset/frequency/headroom descriptions in AUDIO_EQ.md and the mode-preservation behavior in DX_CLUSTER.md. No push or deployment.

## Five targeted checks

1. DX: targeted model cases cover 15/20m USB, 40/80/160m LSB, CW sections, 60m USB exception, explicit modes, FT8 USB and ambiguous DATA/mixed/beacon/unknown preservation. Browser replay used unchanged captured real HamQTH records (clock fixed for freshness), while connected to the real Niendorf SDR. 21194 USB, 7175 LSB, 24890 CW, 14080 DIGI retaining CW/manual dialog passed. Exactly one combined frequency/mode/filter command per click; CW protocol frequency includes the existing 600Hz offset. No new protocol behavior. Generic DIGI/RTTY does not identify an exact demodulator.

2. EQ: three actual playback biquads remain after NOTCH and before volume: low shelf 300Hz, peak 1650Hz Q=.9, high shelf 2600Hz. VOICE -6/+3/+1; DX -12/+5/-6; MUSIC +3/-1/+3 dB. Preamp follows the measured-equivalent cascade maximum with 1.5dB reserve, rather than summing unrelated boosts. Rendered 12-tone response matches native getFrequencyResponse within .02dB. OFF max sample error 0. Same real 105.7368-second LSB input: all output finite, peaks FLAT .451082, VOICE .346467, DX .302589, MUSIC .290332. This verifies no clipping on this input, not every possible transient.

Below: rendered gain relative to original after constant gain matching of the same LSB to -23 LUFS. Integrated loudness span .01 LU; no dynamic normalization/compression.

| Preset | 150 Hz | 1650 Hz | 3200 Hz |
|---|---:|---:|---:|
| FLAT | +0.00 dB | +0.00 dB | +0.00 dB |
| VOICE | -7.11 dB | +1.61 dB | +0.30 dB |
| DX | -12.54 dB | +2.63 dB | -3.79 dB |
| MUSIC | +2.71 dB | -0.68 dB | +1.63 dB |

3. Human SSB listening is NOT confirmed. WAVs prepared for listening: original/flat/voice/dx/music-matched.wav in artifacts/three-fixes. No claim of improved intelligibility, consonant preservation or subjective naturalness. BS.1770 matching is a proxy for perceived loudness.

4. Six LUTs tested against identical input. CLASSIC byte-exact against HEAD renderer; all five other themes change color, returning CLASSIC restores exact pixels. All 36 history rows survive switches with their original normalization. ICE persists through reload. No FFT/scroll/scale changes. History stores bounded raw rows and original per-row levels for recoloring.

5. TypeScript and production build pass. Live PCM/output samples remain finite/nonzero, 77 packets and 60 waterfall rows observed across band changes and EQ activation. Three actual BiquadFilterNodes present; no page errors. Source review confirms protected modules unchanged; no broad retest of unrelated functionality.

Artifacts: eq-response.json, listening-levels.json, palettes.json, live.json and live.png; targeted harnesses in the same directory. Existing protected source files were not modified.
