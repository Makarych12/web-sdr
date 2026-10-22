export const WATERFALL_THEMES = ['CLASSIC','SDR BLUE','FIRE','RAINBOW','GREEN','ICE'] as const;
export type WaterfallTheme = typeof WATERFALL_THEMES[number];
export function validWaterfallTheme(value:unknown):value is WaterfallTheme { return WATERFALL_THEMES.includes(value as WaterfallTheme); }
export const THEME_STOPS:Record<WaterfallTheme,number[][]>={
 CLASSIC:[[0,2,5,13],[.18,6,21,65],[.36,15,75,161],[.54,13,175,201],[.7,58,204,117],[.84,224,213,49],[.95,247,121,24],[1,226,44,29]],
 'SDR BLUE':[[0,0,3,12],[.2,0,15,52],[.45,0,65,135],[.7,0,148,215],[.88,82,213,251],[1,225,249,255]],
 FIRE:[[0,0,0,0],[.25,60,0,0],[.5,160,17,0],[.72,239,74,0],[.9,255,174,0],[1,255,246,129]],
 RAINBOW:[[0,2,2,12],[.18,40,15,99],[.36,14,79,172],[.54,0,168,178],[.7,104,205,82],[.84,239,213,54],[.94,248,125,42],[1,255,218,213]],
 GREEN:[[0,0,5,1],[.25,0,29,10],[.5,0,87,29],[.75,31,162,54],[.9,126,220,114],[1,222,255,204]],
 ICE:[[0,1,4,14],[.25,13,26,65],[.5,39,82,128],[.75,106,166,202],[.9,185,222,241],[1,249,254,255]],
};
