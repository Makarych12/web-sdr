import { WATERFALL_THEME_KEY } from "./waterfallThemes";

/** Retire the removed appearance preference without touching receiver settings. */
export function retireLegacyAppearance() {
  delete document.documentElement.dataset.radioTheme;
  try {
    const legacy = localStorage.getItem("ur4mtn.appearance.v1");
    if (legacy === '"vintage"' || legacy === "vintage")
      localStorage.setItem(WATERFALL_THEME_KEY, JSON.stringify("OCEAN BLUE"));
    localStorage.removeItem("ur4mtn.appearance.v1");
  } catch { /* The default Ocean Blue appearance also works without storage. */ }
}
