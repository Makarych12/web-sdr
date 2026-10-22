export type WaterfallMode = 'CLASSIC' | 'MALAHIT DSP';
export type WaterfallDisplay = { mode:WaterfallMode; contrast:number; brightness:number; rangeDb:number };
export const DEFAULT_WATERFALL_DISPLAY:WaterfallDisplay={mode:'CLASSIC',contrast:1.2,brightness:-6,rangeDb:45};
export function validWaterfallDisplay(value:unknown):value is WaterfallDisplay {
 const v=value as WaterfallDisplay;
 return !!v && (v.mode==='CLASSIC'||v.mode==='MALAHIT DSP') && Number.isFinite(v.contrast)&&v.contrast>=.5&&v.contrast<=2.5 && Number.isFinite(v.brightness)&&v.brightness>=-30&&v.brightness<=30 && Number.isFinite(v.rangeDb)&&v.rangeDb>=25&&v.rangeDb<=100;
}
/** Sliding low percentile estimates local background, never relocates a bin. */
function localFloor(bins:Uint8Array) {
 const histogram=new Uint16Array(256),floor=new Float32Array(bins.length),radius=16;
 const at=(i:number)=>bins[Math.max(0,Math.min(bins.length-1,i))];
 for(let i=-radius;i<=radius;i++)histogram[at(i)]++;
 for(let i=0;i<bins.length;i++){
  let count=0,q=0;for(;q<255;q++){count+=histogram[q];if(count>=12)break;}
  floor[i]=q;
  histogram[at(i-radius)]--;histogram[at(i+radius+1)]++;
 }
 return floor;
}
/** Display-only spatial/temporal background separation, not an audio/FFT filter.
 * Current-bin energy gates every pixel: previous rows can never extend a mark.
 * This cannot recover an RF signal below the receiver's noise/resolution floor.
 */
export function malahitRow(bins:Uint8Array,previous:Uint8Array|null,noiseBin:number,previousNoiseBin:number,settings:WaterfallDisplay) {
 const floor=localFloor(bins),display=new Uint8Array(bins.length);
 for(let i=0;i<bins.length;i++){
  const local=noiseBin+.35*Math.max(-8,Math.min(8,floor[i]-noiseBin));
  const excess=Math.max(0,bins[i]-local-1.5);
  const earlier=previous?Math.max(0,previous[i]-previousNoiseBin-1.5):excess;
  const coherent=Math.min(excess,earlier);
  // Reject uncorrelated grain while retaining the first packet of a new signal.
  const energy=excess*(.4+.6*(1-Math.exp(-coherent/4)));
  const compressed=Math.log1p(.12*energy)/Math.log1p(.12*settings.rangeDb);
  const normalized=Math.max(0,Math.min(1,compressed+settings.brightness/100));
  display[i]=Math.round(255*normalized**(1/settings.contrast));
 }
 return display;
}
