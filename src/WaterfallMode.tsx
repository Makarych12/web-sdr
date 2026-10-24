import {useEffect,useRef,useState} from 'react';
import {WATERFALL_THEMES,waterfallThemeGradient,type WaterfallTheme} from './waterfallThemes';
import type {WaterfallDisplay,WaterfallMode as Mode} from './waterfallMode';
import './waterfall-mode.css';
function fitPanel(panel:HTMLDialogElement|null) {
 if(!panel)return;
 const viewport=window.visualViewport;
 for(const [name,value] of Object.entries({width:viewport?.width??window.innerWidth,height:viewport?.height??window.innerHeight,left:viewport?.offsetLeft??0,top:viewport?.offsetTop??0}))
  panel.style.setProperty(`--wf-viewport-${name}`,`${value}px`);
}
export function WaterfallMode({settings,onChange,theme,onThemeChange}:{settings:WaterfallDisplay;onChange:(value:WaterfallDisplay)=>void;theme:WaterfallTheme;onThemeChange:(value:WaterfallTheme)=>void}) {
 const [open,setOpen]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),enhanced=settings.mode==='MALAHIT DSP',pro=settings.mode==='SDR PRO';
 useEffect(()=>{
  if(!open)return;
  const fit=()=>fitPanel(dialog.current);
  fit();
  window.addEventListener('resize',fit);
  window.visualViewport?.addEventListener('resize',fit);
  window.visualViewport?.addEventListener('scroll',fit);
  return ()=>{
   window.removeEventListener('resize',fit);
   window.visualViewport?.removeEventListener('resize',fit);
   window.visualViewport?.removeEventListener('scroll',fit);
  };
 },[open]);
 const close=()=>dialog.current?.close();
 return <div className="waterfall-settings">
  <button type="button" className="waterfall-settings-launch" aria-label="Настройки водопада" aria-haspopup="dialog" aria-expanded={open} title="Настройки водопада" onClick={()=>{fitPanel(dialog.current);dialog.current?.showModal();setOpen(true);}}>
   <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 3-.6 2.3-2 .9-2.1-.7-2 3.5L4 10.7v2.6L2.3 15l2 3.5 2.1-.7 2 .9L9 21h4l.6-2.3 2-.9 2.1.7 2-3.5-1.7-1.7v-2.6L19.7 9l-2-3.5-2.1.7-2-.9L13 3Z"/>
    <circle cx="11" cy="12" r="3"/>
   </svg>
  </button>
  <dialog ref={dialog} className="waterfall-mode-panel" aria-labelledby="waterfall-settings-title" onClose={()=>setOpen(false)} onKeyDown={e=>e.stopPropagation()} onClick={e=>{
   if(e.target!==e.currentTarget)return;
   const rect=e.currentTarget.getBoundingClientRect();
   if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)close();
  }}>
   <header><div><small>DISPLAY SETTINGS</small><strong id="waterfall-settings-title">Настройки водопада</strong></div><button type="button" aria-label="Закрыть настройки водопада" onClick={close}>×</button></header>
   <section className="waterfall-settings-group" aria-label="Режим водопада">
    <h4>РЕЖИМ</h4>
    <div className="waterfall-mode-options">{(['CLASSIC','MALAHIT DSP','SDR PRO'] as Mode[]).map(mode=><button type="button" key={mode} aria-pressed={settings.mode===mode} onClick={()=>{onChange({...settings,mode});close();}}>{mode}</button>)}</div>
   </section>
   <section className="waterfall-settings-group" aria-label="Палитра водопада">
    <h4>ПАЛИТРА</h4>
    <div className="waterfall-theme-options">{WATERFALL_THEMES.map(name=><button type="button" key={name} aria-pressed={theme===name} onClick={()=>{onThemeChange(name);close();}}>
     <span className="waterfall-theme-preview" aria-hidden="true" style={{background:waterfallThemeGradient(name)}}/>
     <span>{name}</span><span className="waterfall-choice-check" aria-hidden="true">{theme===name?'✓':''}</span>
    </button>)}</div>
   </section>
   <details className="waterfall-adjustments">
   <summary>Уровни и точная настройка</summary>
   <p>{pro?'Адаптивная экспозиция всей FFT-строки и мягкое сжатие сильных сигналов.':enhanced?'Локальный фон + подавление некоррелированного зерна по соседним FFT-строкам.':'Общая калиброванная шкала спектра и водопада.'}</p>
   <fieldset className="scope-levels">
    <legend>SPECTRUM / WATERFALL · dB</legend>
    <label className="scope-auto"><input aria-label="Автоуровень по шумовому полу" type="checkbox" checked={settings.autoLevel??true} onChange={e=>onChange({...settings,autoLevel:e.target.checked})}/> AUTO · шумовой пол</label>
    <label>REF LEVEL · {(settings.autoLevel??true)?'AUTO':`${settings.refLevel??-40} dBm`}<input aria-label="REF LEVEL" type="range" min="-140" max="10" step="1" disabled={settings.autoLevel??true} value={settings.refLevel??-40} onChange={e=>onChange({...settings,refLevel:Number(e.target.value)})}/></label>
    <label>RANGE · {settings.levelRangeDb??60} dB<input aria-label="RANGE" type="range" min="30" max="100" step="5" value={settings.levelRangeDb??60} onChange={e=>onChange({...settings,levelRangeDb:Number(e.target.value)})}/></label>
    <small>Шкала dBm использует калибровку Kiwi. AUTO плавно отслеживает фон; REF LEVEL задаёт верхний уровень вручную.</small>
   </fieldset>
   {pro?<fieldset>
    <label>Контраст SDR PRO · {(settings.proContrast??1.1).toFixed(1)}<input aria-label="Контраст SDR PRO" type="range" min="0.5" max="2.5" step="0.1" value={settings.proContrast??1.1} onChange={e=>onChange({...settings,proContrast:Number(e.target.value)})}/></label>
    <label>Чувствительность SDR PRO · {settings.proSensitivity??0} dB<input aria-label="Чувствительность SDR PRO" type="range" min="-12" max="18" step="1" value={settings.proSensitivity??0} onChange={e=>onChange({...settings,proSensitivity:Number(e.target.value)})}/></label>
   </fieldset>:<fieldset disabled={!enhanced}>
    <label>Контраст · {settings.contrast.toFixed(1)}<input aria-label="Контраст водопада" type="range" min="0.5" max="2.5" step="0.1" value={settings.contrast} onChange={e=>onChange({...settings,contrast:Number(e.target.value)})}/></label>
    <label>Яркость · {settings.brightness>0?'+':''}{settings.brightness}%<input aria-label="Яркость водопада" type="range" min="-30" max="30" step="1" value={settings.brightness} onChange={e=>onChange({...settings,brightness:Number(e.target.value)})}/></label>
    <label>Диапазон над фоном · {settings.rangeDb} dB<input aria-label="Диапазон уровней водопада" type="range" min="25" max="100" step="1" value={settings.rangeDb} onChange={e=>onChange({...settings,rangeDb:Number(e.target.value)})}/></label>
   </fieldset>}
   </details>
  </dialog>
 </div>;
}
