import {useRef} from 'react';
import {WATERFALL_THEMES,type WaterfallTheme} from './waterfallThemes';
import './waterfall-color.css';
export function WaterfallColor({theme,onChange}:{theme:WaterfallTheme;onChange:(value:WaterfallTheme)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 return <div className="waterfall-color"><button type="button" aria-label="Цвет водопада COLOR" onClick={()=>dialog.current?.showModal()}>COLOR</button>
 <dialog ref={dialog} className="waterfall-color-panel" aria-label="Палитра водопада" onKeyDown={e=>e.stopPropagation()}>
 <header><strong>COLOR</strong><button type="button" aria-label="Закрыть COLOR" onClick={()=>dialog.current?.close()}>×</button></header>
 {WATERFALL_THEMES.map(name=><button type="button" key={name} aria-pressed={theme===name} onClick={()=>onChange(name)}>{name}</button>)}
 </dialog></div>;
}
