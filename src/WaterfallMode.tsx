import {useRef} from 'react';
import type {WaterfallDisplay,WaterfallMode as Mode} from './waterfallMode';
import './waterfall-mode.css';
export function WaterfallMode({settings,onChange}:{settings:WaterfallDisplay;onChange:(value:WaterfallDisplay)=>void}) {
 const dialog=useRef<HTMLDialogElement>(null),enhanced=settings.mode==='MALAHIT DSP';
 return <div className="waterfall-mode">
  <button type="button" className="waterfall-mode-launch" aria-label="WATERFALL MODE" aria-haspopup="dialog" onClick={()=>dialog.current?.showModal()}><b>WATERFALL MODE</b><small>{settings.mode} ▾</small></button>
  <dialog ref={dialog} className="waterfall-mode-panel" aria-label="WATERFALL MODE" onKeyDown={e=>e.stopPropagation()}>
   <header><strong>WATERFALL MODE</strong><button type="button" aria-label="Закрыть WATERFALL MODE" onClick={()=>dialog.current?.close()}>×</button></header>
   <div className="waterfall-mode-options">{(['CLASSIC','MALAHIT DSP'] as Mode[]).map(mode=><button type="button" key={mode} aria-pressed={settings.mode===mode} onClick={()=>onChange({...settings,mode})}>{mode}</button>)}</div>
   <p>{enhanced?'Локальный фон + подавление некоррелированного зерна по соседним FFT-строкам. Частоты следов сохраняются.':'Исходная отрисовка. COLOR выбирает палитру.'}</p>
   <fieldset disabled={!enhanced}>
    <label>Контраст · {settings.contrast.toFixed(1)}<input aria-label="Контраст водопада" type="range" min="0.5" max="2.5" step="0.1" value={settings.contrast} onChange={e=>onChange({...settings,contrast:Number(e.target.value)})}/></label>
    <label>Яркость · {settings.brightness>0?'+':''}{settings.brightness}%<input aria-label="Яркость водопада" type="range" min="-30" max="30" step="1" value={settings.brightness} onChange={e=>onChange({...settings,brightness:Number(e.target.value)})}/></label>
    <label>Диапазон над фоном · {settings.rangeDb} dB<input aria-label="Диапазон уровней водопада" type="range" min="25" max="100" step="1" value={settings.rangeDb} onChange={e=>onChange({...settings,rangeDb:Number(e.target.value)})}/></label>
   </fieldset>
   <small>Только отображение реальных FFT. Усиление видимости не улучшает радиоприём и не выделяет сигнал ниже шума.</small>
  </dialog>
 </div>;
}
