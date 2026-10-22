export const WATERFALL_THEMES = ['CLASSIC','MALAHIT RAINBOW','FIRE','OCEAN BLUE','ICE','GREEN'] as const;
export type WaterfallTheme = typeof WATERFALL_THEMES[number];
export function validWaterfallTheme(value:unknown):value is WaterfallTheme { return WATERFALL_THEMES.includes(value as WaterfallTheme); }
export const WATERFALL_THEME_KEY='ur4mtn.waterfall-theme.v1';
/** Preserve existing selections when the two palette names change. */
export function readWaterfallTheme():WaterfallTheme {
 try {
  const value:unknown=JSON.parse(localStorage.getItem(WATERFALL_THEME_KEY)||'null');
  if(value==='SDR BLUE')return 'OCEAN BLUE';
  if(value==='RAINBOW')return 'MALAHIT RAINBOW';
  return validWaterfallTheme(value)?value:'CLASSIC';
 } catch { return 'CLASSIC'; }
}
export const THEME_STOPS:Record<WaterfallTheme,number[][]>={
 CLASSIC:[[0,2,5,13],[.18,6,21,65],[.36,15,75,161],[.54,13,175,201],[.7,58,204,117],[.84,224,213,49],[.95,247,121,24],[1,226,44,29]],
 'MALAHIT RAINBOW':[[0,2,0,12],[.12,30,0,75],[.26,35,20,180],[.4,0,100,255],[.53,0,220,230],[.65,20,235,75],[.77,225,235,0],[.88,255,140,0],[.96,255,40,12],[1,255,242,210]],
 FIRE:[[0,0,0,0],[.14,45,0,12],[.3,112,0,8],[.48,202,16,0],[.66,255,74,0],[.83,255,168,0],[1,255,250,180]],
 'OCEAN BLUE':[[0,0,3,15],[.16,0,23,85],[.34,0,64,175],[.53,0,132,230],[.72,0,205,245],[.87,97,236,255],[1,234,253,255]],
 ICE:[[0,1,4,14],[.18,8,32,77],[.38,30,91,151],[.58,80,157,207],[.78,155,215,243],[.91,218,244,255],[1,255,255,255]],
 GREEN:[[0,0,5,1],[.18,0,40,15],[.38,0,99,30],[.6,0,171,51],[.8,76,229,80],[.93,174,250,134],[1,235,255,206]],
};
/** Preview the same LUT stops (gamma transformed back to signal intensity). */
export function waterfallThemeGradient(theme:WaterfallTheme) {
 return `linear-gradient(90deg, ${THEME_STOPS[theme].map(([p,r,g,b])=>`rgb(${r},${g},${b}) ${100*p**(1/.85)}%`).join(', ')})`;
}
