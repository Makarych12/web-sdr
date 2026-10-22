import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { CwDecoder, CW_TEXT_LIMIT, type CwSettings, type CwSnapshot } from "./cwDecoder";
import "./cw-decoder.css";
const empty:CwSnapshot={text:'',textStart:0,wpm:20,acquired:false,confidence:0,tonePresent:false,toneHz:0,levelDb:-120,samples:0,sampleRate:0,state:'Ожидание PCM'};
export function CwDecoderPanel({ input }: { input:MutableRefObject<CwDecoder|null> }) {
  const dialog=useRef<HTMLDialogElement>(null), output=useRef<HTMLTextAreaElement>(null);
  const [enabled,setEnabled]=useState(false),[settings,setSettings]=useState<CwSettings>({tone:600,autoTone:true,auto:true,wpm:20});
  const [wpmDraft,setWpmDraft]=useState('20');
  const [snapshot,setSnapshot]=useState<CwSnapshot>(empty),[message,setMessage]=useState('');
  const transcript=useRef(''),manualEdit=useRef(false);
  function stop(){if(input.current){const s=input.current.snapshot();transcript.current=s.text;setSnapshot({...s,confidence:0,tonePresent:false});}input.current=null;setEnabled(false);}
  function start(){input.current=new CwDecoder(settings,transcript.current);setSnapshot(input.current.snapshot());setEnabled(true);setMessage('');}
  function configure(next:CwSettings){setSettings(next);input.current?.configure(next);}
  useEffect(()=>{
    if(!enabled)return;
    const timer=setInterval(()=>{if(input.current){const area=output.current;if(area&&document.activeElement===area&&area.selectionStart!==area.selectionEnd)return;const s=input.current.snapshot();transcript.current=s.text;setSnapshot(s);}},150);
    return()=>clearInterval(timer);
  },[enabled,input]);
  useEffect(()=>()=>{input.current=null;},[input]);
  useEffect(()=>{if(manualEdit.current){manualEdit.current=false;return;}if(output.current&&output.current.selectionStart===output.current.selectionEnd)output.current.scrollTop=output.current.scrollHeight;},[snapshot.text]);
  return <>
    <button type="button" className="cw-dec-launch" aria-label="Открыть CW DEC" onClick={()=>dialog.current?.showModal()}>CW DEC</button>
    <dialog ref={dialog} className="cw-dec-panel" aria-labelledby="cw-dec-title" onClose={stop} onKeyDown={e=>e.stopPropagation()}>
      <header><strong id="cw-dec-title">CW DECODER</strong><button type="button" aria-label="Закрыть CW DEC" onClick={()=>dialog.current?.close()}>×</button></header>
      <button type="button" aria-pressed={enabled} onClick={()=>enabled?stop():start()}>CW DEC {enabled?'ON':'OFF'}</button>
      <label><input type="checkbox" checked={settings.autoTone??false} onChange={e=>configure({...settings,autoTone:e.target.checked})}/>AUTO TONE</label>
      <label>Ручной тон · {settings.tone} Hz<input aria-label="Тон CW" type="range" min="300" max="1000" step="5" disabled={settings.autoTone} value={settings.tone} onChange={e=>configure({...settings,tone:Number(e.target.value)})}/></label>
      <label><input type="checkbox" checked={settings.auto} onChange={e=>configure({...settings,auto:e.target.checked})}/>AUTO WPM</label>
      <label>Ручная скорость · WPM<input aria-label="Скорость CW WPM" type="number" min="5" max="40" step="1" disabled={settings.auto} value={wpmDraft} onChange={e=>{setWpmDraft(e.target.value);const wpm=Number(e.target.value);if(Number.isInteger(wpm)&&wpm>=5&&wpm<=40)configure({...settings,wpm});}} onBlur={()=>setWpmDraft(String(settings.wpm))}/></label>
      <output>{enabled?(snapshot.acquired?`${snapshot.wpm} WPM`:'Определение скорости…'):'Обработка остановлена'} · {enabled&&snapshot.tonePresent?'Тон обнаружен':'Пауза / нет тона'}</output>
      <output>{enabled?`${snapshot.state} · ${snapshot.toneHz||'—'} Hz · ${snapshot.levelDb.toFixed(1)} dBFS · PCM ${snapshot.sampleRate||'—'} Hz / ${snapshot.samples} отсч.`:'PCM-анализ выключен'}</output>
      <p>Уверенность: {enabled?snapshot.confidence:0}/100 — оценка сигнала и ритма, не вероятность правильного текста.</p>
      <textarea ref={output} aria-label="Декодированный CW текст" value={snapshot.text} onChange={e=>{
        manualEdit.current=true;
        if(input.current){input.current.editText(snapshot,e.target.value);const next=input.current.snapshot();transcript.current=next.text;setSnapshot(next);}
        else {const text=e.target.value.slice(-CW_TEXT_LIMIT);transcript.current=text;setSnapshot({...snapshot,text,textStart:0});}
      }} placeholder="Здесь появятся символы, распознанные из принимаемого PCM" rows={7}/>
      <button type="button" disabled={!snapshot.text} onClick={async()=>{try{await navigator.clipboard.writeText(input.current?.snapshot().text??transcript.current);setMessage('Скопировано');}catch{setMessage('Не удалось скопировать: проверьте разрешение буфера обмена');}}}>COPY</button>
      <button type="button" onClick={()=>{input.current?.clearText();transcript.current='';setSnapshot(input.current?.snapshot()??{...snapshot,text:'',textStart:0});setMessage('');}}>CLEAR</button>
      {message&&<small role="status">{message}</small>}
      <p>Настройте тон принимаемой станции. Помехи, замирания и неровная передача дают ошибки; � — неизвестный символ. Закрытие панели выключает декодер.</p>
    </dialog>
  </>;
}
