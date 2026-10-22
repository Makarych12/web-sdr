import { BAND_PLAN } from './bandPlan';
import type { Mode } from './radio';
import type { DxSpot } from './dxCluster';
export type DxModeDecision = { mode: Mode; uncertain: boolean; reason: string };
/** HamQTH CW/SSB/DIGI are groups; DIGI is not an exact demodulator. */
export function dxMode(spot: Pick<DxSpot,'frequency'|'mode'>, current: Mode): DxModeDecision {
  const reported=spot.mode?.trim().toUpperCase();
  const exact:Record<string,Mode>={USB:'USB',LSB:'LSB',CW:'CW',AM:'AM',FM:'FM'};
  if(reported && exact[reported])return {mode:exact[reported],uncertain:false,reason:`Режим спота: ${reported}`};
  if(reported && ['FT8','FT4','JS8','JT65','JT9','PSK31','PSK63'].includes(reported))return {mode:'USB',uncertain:false,reason:`${reported}: звуковой приём USB; цифровой декодер не включается`};
  const manual=(reason:string):DxModeDecision=>({mode:current,uncertain:true,reason});
  if(reported==='DIGI'||reported==='DATA'||reported==='RTTY')return manual(`${reported}: точный вид модуляции не указан; выберите режим вручную`);
  if(reported && reported!=='SSB')return manual(`Неизвестный режим ${reported}; выберите модуляцию вручную`);
  const f=spot.frequency,segment=BAND_PLAN.find(s=>f>=s.start&&f<s.end);
  // 60m phone is an exception to the below-10MHz LSB convention.
  if(reported==='SSB' && f>=5354 && f<5366.5)return {mode:'USB',uncertain:false,reason:'SSB 60m: USB'};
  if(segment?.usage==='CW')return reported==='SSB'?manual('Спот SSB противоречит CW-участку Region 1'): {mode:'CW',uncertain:false,reason:'CW-участок Region 1'};
  if(segment?.usage==='DATA'||segment?.usage==='SSB/DATA')return manual(`${segment.usage}: требуется ручной выбор модуляции`);
  if(segment?.usage==='SSB' && (!reported || reported==='SSB'))return {mode:f<10000?'LSB':'USB',uncertain:false,reason:`SSB Region 1: ${f<10000?'LSB':'USB'}`};
  return manual('Точный режим не определён по споту и Region 1; текущий режим сохранён');
}
