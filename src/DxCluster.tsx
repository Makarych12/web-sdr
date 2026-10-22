import { useLayoutEffect, useRef, useState } from "react";
import { dxAvailable, dxBand, freshDx, projectDx, type DxRange, type DxSpot } from "./dxCluster";
import type { DxFeed } from "./useDxCluster";
import "./dx-cluster.css";
type Props = { feed: DxFeed; frequency: number; range: DxRange; currentBandOnly: boolean; onBandOnly: (value: boolean) => void; onTune: (spot: DxSpot) => void };
const utc = (time: number) => new Date(time).toISOString().slice(11,19);
export function DxClusterPanel(props: Props) {
  const { feed, frequency, range, currentBandOnly, onBandOnly, onTune } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const band = dxBand(frequency);
  const spots = currentBandOnly && !band ? [] : freshDx(feed.spots, feed.now, currentBandOnly ? band : null);
  return <>
    <button type="button" className="dx-launch" aria-label="Открыть DX CLUSTER" onClick={() => { feed.enable(); dialog.current?.showModal(); }}>DX</button>
    <dialog className="dx-panel" ref={dialog} aria-labelledby="dx-title" onKeyDown={e => e.stopPropagation()}>
      <header><strong id="dx-title">DX CLUSTER</strong><button type="button" aria-label="Закрыть DX CLUSTER" onClick={() => dialog.current?.close()}>×</button></header>
      <label><input type="checkbox" checked={currentBandOnly} onChange={e => onBandOnly(e.target.checked)} />Текущий диапазон{band ? ` · ${band}` : " · вне любительских КВ-диапазонов"}</label>
      <small>Последние 200 сообщений, не старше 30 минут. Обновление раз в 60 с при видимой вкладке.</small>
      {feed.error && <p role="alert">{feed.error} Метки скрыты; список — последнее полученное состояние.</p>}
      {!range && <p>Диапазон приёмника пока неизвестен; переход по частоте недоступен.</p>}
      <div className="dx-list">{spots.map(spot => <article key={spot.id}>
        <button type="button" disabled={!dxAvailable(spot,range)} title={!dxAvailable(spot,range) ? "Частота недоступна выбранному приёмнику" : "Настроить VFO"}
          onClick={() => { if (dxAvailable(spot,range)) { onTune(spot); dialog.current?.close(); } }}>
          <b>{spot.call}</b> · {spot.frequency} kHz
        </button><small>{utc(spot.time)} UTC · HamQTH / {spot.spotter}</small>
      </article>)}</div>
      {!spots.length && !feed.error && <p>{feed.updated ? "Свежих спотов по выбранному фильтру нет" : "Загрузка реальных спотов…"}</p>}
      {feed.updated && <small>Получено: {utc(feed.updated)} UTC</small>}
      <p>Data provided by <a href="https://www.hamqth.com/" target="_blank" rel="noreferrer">HamQTH.com</a>. Регистрируйтесь на HamQTH и поддерживайте свой профиль в актуальном состоянии.</p>
      <small>Споты — сообщения участников кластера, а не подтверждение приёма этой SDR.</small>
    </dialog>
  </>;
}
export function DxMarkers({ spots, view, range, onTune, waterfall = false }: { spots: DxSpot[]; view: { start: number; span: number }; range: DxRange; onTune: (spot: DxSpot) => void; waterfall?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [width,setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = host.current!;
    const resize = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth); resize.observe(element); return () => resize.disconnect();
  },[]);
  return <div ref={host} className={`dx-markers${waterfall ? " dx-waterfall" : ""}`}>
    {projectDx(spots,view,width).map(({spot,x,labelLeft,lane}) => <div key={spot.id}>
      <i aria-hidden="true" style={{left:x}} />
      <button type="button" style={{left:labelLeft,top:(waterfall ? 4 : 42)+lane*22}}
        data-dx-frequency={spot.frequency} data-dx-x={x} disabled={!dxAvailable(spot,range)}
        aria-label={`DX ${spot.call} ${spot.frequency} kHz`} title={`${spot.call} · ${spot.frequency} kHz · ${utc(spot.time)} UTC · HamQTH / ${spot.spotter}${!dxAvailable(spot,range) ? " · частота недоступна" : ""}`}
        onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
        onClick={() => { if(dxAvailable(spot,range)) onTune(spot); }}>{spot.call}</button>
    </div>)}
  </div>;
}
