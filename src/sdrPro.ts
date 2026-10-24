export type SdrProLevels = { floor:number; range:number };
/** Global robust exposure, shared by every frequency in a row: broad SSB is not
 * subtracted as local background, and narrow CW never sets the whole black level.
 * Values are in the original Kiwi byte's dB steps, not altered RF magnitudes. */
export function sdrProLevels(bins:Uint8Array,previous?:SdrProLevels):SdrProLevels {
 const histogram=new Uint16Array(256);
 for(const bin of bins)histogram[bin]++;
 const percentile=(fraction:number)=>{let count=0;const rank=Math.ceil(bins.length*fraction);for(let i=0;i<256;i++){count+=histogram[i];if(count>=rank)return i;}return 255;};
 const floor=percentile(.34),range=Math.max(36,Math.min(96,percentile(.995)-floor+10));
 if(!previous)return {floor,range};
 return {floor:previous.floor+.08*(floor-previous.floor),range:previous.range+(range>previous.range?.35:.04)*(range-previous.range)};
}
/** Per-bin monotone soft-knee exposure; no frequency smoothing, ridge generation,
 * mark persistence or neighbour suppression. Keep strong peaks below clipping. */
export function sdrProRow(bins:Uint8Array,levels:SdrProLevels,contrast:number,sensitivity:number) {
 const pixels=new Uint8Array(bins.length);
 for(let i=0;i<bins.length;i++){
  const position=Math.max(0,(bins[i]-levels.floor+sensitivity)/levels.range);
  const display=position<=.65?.65*(position/.65)**(1/contrast):.65+.35*(1-Math.exp(-(position-.65)/.35));
  pixels[i]=Math.min(254,Math.round(255*display));
 }
 return pixels;
}
