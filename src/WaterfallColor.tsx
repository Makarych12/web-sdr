import {useRef,useState} from 'react';
import {WATERFALL_THEMES,waterfallThemeGradient,type WaterfallTheme} from './waterfallThemes';
import './waterfall-color.css';
export function WaterfallColor({theme,onChange}:{theme:WaterfallTheme;onChange:(value:WaterfallTheme)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false);
 return <div className="waterfall-color">
 <button type="button" className="waterfall-color-launch" aria-label="Цвет водопада COLOR" aria-haspopup="dialog" aria-expanded={open} title={`Палитра водопада: ${theme}`} onClick={()=>{dialog.current?.showModal();setOpen(true);}}>
  <span className="waterfall-theme-preview" aria-hidden="true" style={{background:waterfallThemeGradient(theme)}}/>
  <span><b>COLOR</b><small>{theme}</small></span><span aria-hidden="true">▾</span>
 </button>
 <dialog ref={dialog} className="waterfall-color-panel" aria-label="Палитра водопада" onClose={()=>setOpen(false)} onKeyDown={e=>e.stopPropagation()}>
 <header><strong>WATERFALL COLOR</strong><button type="button" aria-label="Закрыть COLOR" onClick={()=>dialog.current?.close()}>×</button></header>
 <div className="waterfall-theme-options">{WATERFALL_THEMES.map(name=><button type="button" key={name} aria-pressed={theme===name} onClick={()=>onChange(name)}>
  <span>{name}<span aria-hidden="true">{theme===name?' ✓':''}</span></span>
  <span className="waterfall-theme-preview" aria-hidden="true" style={{background:waterfallThemeGradient(name)}}/>
 </button>)}</div>
 <small>Цвет показывает интенсивность реального сигнала. Изменяется только палитра.</small>
 </dialog></div>;
}
