# WATERFALL THEMES — local verification, 2026-10-22

No publication, commit or push. Previous uncommitted spectrum/CW work is retained unchanged by this stage.

## Why the previous control was missed

Six real LUTs and main.tsx → renderer.setTheme wiring already existed. The previous COLOR launcher measured only 44×24px, with a 10px font, dark background and no preview. It sat at the lower right of the waterfall. Live browser screenshots exposed a further concrete problem: the fixed “Карта репитеров” button overlapped this position. The control was not absent from code and the palettes were not disconnected.

COLOR is now a contrasting 44px-minimum-height control at the lower left, with the selected theme and a swatch. Only this control moves; the waterfall, scale and other controls retain their layout. A compact modal shows six miniature gradients derived from the same LUT stops. These gradients are confined to UI controls and the intensity legend; they do not cover or fabricate waterfall signal data.

## Palettes and persistence

CLASSIC retains its exact original stops. Available choices: CLASSIC, MALAHIT RAINBOW, FIRE, OCEAN BLUE, ICE, GREEN. The five other tables use saturated dark-to-bright colors for real intensity. MALAHIT RAINBOW is a custom palette in the requested style, not a claim to reproduce an undocumented hardware LUT exactly.

Only existing renderer LUT selection changes. No renderer, FFT, levels, dimensions, speed, scrolling, frequency, transport, audio or decoder code was edited in this stage. Existing raw historical rows are recolored by the existing renderer; the source bins and their normalization remain unchanged. The localStorage key stays `ur4mtn.waterfall-theme.v1`. Previously saved SDR BLUE maps to OCEAN BLUE; RAINBOW maps to MALAHIT RAINBOW. Invalid/unavailable storage safely defaults to CLASSIC.

## Five focused checks

1. Source/control audit and baseline browser measurement: six prior LUTs wired to real rendering; old control 44×24px / 10px font, no preview. Before screenshot and measured JSON saved.
2. Live Niendorf KiwiSDR at 7020kHz, CW, zoom10, view 7005.350589752197–7034.647464752197kHz. Waited for all 480 history rows to fill from actual W/F packets, then selected all six themes and captured each waterfall. Visually inspected every screenshot and the chooser. At each setTheme call, raw-row references, row count, sequence, source views, pending queue, noise normalization and spectrum envelope identity stayed unchanged. During all switches WebSocket creation count stayed 3→3 and tune/view command count 2→2; these include the existing application/receiver connections, not three new theme connections. PCM packets continued 643→722. Frequency stayed 7020000Hz, history remained 480 rows, visual element geometry unchanged; no page errors.
3. Reload persistence: GREEN restored on desktop. Both old names migrated to their requested new names and were saved canonically; ICE restored on mobile reload.
4. Mobile 390px: chooser fits horizontally, all six previews present; COLOR measured 144×47px, center hit-test reaches the button and the button opens the modal. Screenshots inspected. New desktop screenshots confirm the fixed map control no longer covers COLOR.
5. TypeScript + Vite production build pass; git diff --check clean. Protected feature implementations are not edited. No mass test suite or dependency installation.

## Changed files in this stage

- src/WaterfallColor.tsx — visible launcher, active theme, previews, compact picker.
- src/waterfall-color.css — contrast, touch target, lower-left anchoring, responsive picker.
- src/waterfallThemes.ts — requested names/tables, shared preview gradient, legacy preference reader.
- src/main.tsx — palette preference initialization/migration and matching intensity-legend gradient only.
- docs/WATERFALL_THEMES_CHECK.md — this report.

## Real screenshots and local harnesses

All waterfall screenshots below come from the same continuously running real receiver session. Signal histories naturally advance between screenshots. No fabricated signals, generated pictures or decorative canvas overlays.

![MALAHIT RAINBOW](../artifacts/waterfall-themes/malahit-rainbow.png)
![FIRE](../artifacts/waterfall-themes/fire.png)
![OCEAN BLUE](../artifacts/waterfall-themes/ocean-blue.png)

Additional images: artifacts/waterfall-themes/{classic,ice,green,chooser,mobile-chooser,before}.png. Results: live.json, mobile-storage.json, before.json. Focused local harnesses before.mjs, live.mjs and mobile-storage.mjs are in the same folder and use the existing Chrome/Playwright installation. Screenshots and artifacts are local, not bundled with the app.
