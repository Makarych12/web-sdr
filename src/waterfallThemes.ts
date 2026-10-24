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
  return validWaterfallTheme(value)?value:'OCEAN BLUE';
 } catch { return 'OCEAN BLUE'; }
}
export const THEME_STOPS:Record<WaterfallTheme,number[][]>={
 CLASSIC:[[0,2,5,13],[.16,4,18,54],[.28,0,80,180],[.42,0,190,235],[.56,20,225,140],[.7,55,240,50],[.83,250,225,20],[.93,255,120,16],[1,226,44,29]],
 'MALAHIT RAINBOW':[[0,2,6,18],[.14,4,22,65],[.28,0,85,190],[.42,0,195,240],[.55,15,230,140],[.68,50,245,50],[.8,255,235,15],[.9,255,135,15],[.97,245,35,20],[1,255,160,140]],
 FIRE:[[0,0,0,0],[.14,45,0,12],[.3,112,0,8],[.48,202,16,0],[.66,255,74,0],[.83,255,168,0],[1,255,250,180]],
 'OCEAN BLUE':[[0,2,8,24],[.16,4,20,62],[.29,4,75,160],[.43,0,185,230],[.56,25,220,135],[.7,210,228,40],[.84,255,150,25],[.94,250,60,25],[1,222,35,32]],
 ICE:[[0,1,4,14],[.18,8,32,77],[.38,30,91,151],[.58,80,157,207],[.78,155,215,243],[.91,218,244,255],[1,255,255,255]],
 GREEN:[[0,0,5,1],[.18,0,40,15],[.38,0,99,30],[.6,0,171,51],[.8,76,229,80],[.93,174,250,134],[1,235,255,206]],
};
/** Preview the same LUT stops (gamma transformed back to signal intensity). */
export function waterfallThemeGradient(theme:WaterfallTheme) {
 return `linear-gradient(90deg, ${THEME_STOPS[theme].map(([p,r,g,b])=>`rgb(${r},${g},${b}) ${100*p**(1/.85)}%`).join(', ')})`;
}
