import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { BANDS, dxAvailable, dxBand, freshDx, projectDx, type DxRange, type DxSpot } from "./dxCluster";
import { MODES, type Mode } from "./radio";
import type { DxFeed } from "./useDxCluster";
import "./dx-cluster.css";

export type DxClusterHandle = { open: () => void };
type Props = {
  openRef?: Ref<DxClusterHandle>;
  feed: DxFeed;
  frequency: number;
  range: DxRange;
  currentBandOnly: boolean;
  onBandOnly: (value: boolean) => void;
  onTune: (spot: DxSpot) => void;
};

const utc = (time: number) => new Date(time).toISOString().slice(11,19);

export function DxClusterPanel(props: Props) {
  const { feed, frequency, range, currentBandOnly, onBandOnly, onTune } = props;
  const [selectedBand, setSelectedBand] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = () => { feed.enable(); if (!dialog.current?.open) dialog.current?.showModal(); };
  useImperativeHandle(props.openRef, () => ({ open }));
  const band = dxBand(frequency);
  const activeBand = currentBandOnly ? (band ?? "__none__") : selectedBand;
  const spots = activeBand === "__none__" ? [] : freshDx(feed.spots, feed.now, activeBand);

  return <>
    <button type="button" className="dx-launch" aria-label="Открыть DX CLUSTER" title="DX Cluster · реальные споты HamQTH" onClick={open}>DX CLUSTER</button>
    <dialog className="dx-panel" ref={dialog} aria-labelledby="dx-title" onKeyDown={e => e.stopPropagation()}>
      <header>
        <strong id="dx-title">DX CLUSTER</strong>
        <div className="dx-header-actions">
          <button type="button" className="dx-refresh" aria-label="Обновить DX spots" title="Обновить споты HamQTH" onClick={() => feed.refresh()}>⟳</button>
          <button type="button" aria-label="Закрыть DX CLUSTER" onClick={() => dialog.current?.close()}>×</button>
        </div>
      </header>

      <div className="dx-band-selector" role="group" aria-label="Фильтр по диапазону">
        <button
          type="button"
          className={!currentBandOnly && !selectedBand ? "active" : ""}
          onClick={() => { setSelectedBand(null); onBandOnly(false); }}
        >
          Все
        </button>
        {BANDS.map(([b]) => (
          <button
            type="button"
            key={b}
            className={(!currentBandOnly && selectedBand === b) || (currentBandOnly && band === b) ? "active" : ""}
            onClick={() => {
              if (selectedBand === b && !currentBandOnly) {
                setSelectedBand(null);
              } else {
                setSelectedBand(b);
                onBandOnly(false);
              }
            }}
          >
            {b}
          </button>
        ))}
      </div>

      <label>
        <input
          type="checkbox"
          checked={currentBandOnly}
          onChange={e => {
            onBandOnly(e.target.checked);
            if (e.target.checked) setSelectedBand(null);
          }}
        />
        Текущий диапазон{band ? ` · ${band}` : " · вне любительских КВ-диапазонов"}
      </label>

      <small>Последние 200 сообщений, не старше 30 минут. Обновление раз в 60 с при видимой вкладке.</small>
      {feed.error && <p role="alert">{feed.error} Метки скрыты; список — последнее полученное состояние.</p>}
      {!range && <p>Диапазон приёмника пока неизвестен; переход по частоте недоступен.</p>}
      <div className="dx-list">{spots.map(spot => <article key={spot.id}>
        <button type="button" disabled={!dxAvailable(spot,range)} title={!dxAvailable(spot,range) ? "Частота недоступна выбранному приёмнику" : "Настроить VFO"}
          onClick={() => { if (dxAvailable(spot,range)) { onTune(spot); dialog.current?.close(); } }}>
          <b>{spot.call}</b> · {spot.frequency} kHz
        </button><small>{utc(spot.time)} UTC · {spot.mode ?? "режим неизвестен"} · HamQTH / {spot.spotter}</small>
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

export function DxModePrompt({ pending, current, onSelect, onClose }: { pending: { reason: string } | null; current: Mode; onSelect: (mode: Mode) => void; onClose: () => void }) {
  const dialog=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{if(pending&&!dialog.current?.open)dialog.current?.showModal();else if(!pending&&dialog.current?.open)dialog.current.close();},[pending]);
  return <dialog ref={dialog} className="dx-panel" aria-label="Режим DX-спота" onClose={onClose} onKeyDown={e=>e.stopPropagation()}>
    <strong>Выберите модуляцию</strong><p>{pending?.reason}</p><p>Сохранён {current}. Частота уже установлена.</p>
    <div>{MODES.map(m=><button type="button" key={m} onClick={()=>onSelect(m)}>{m}</button>)}</div>
    <button type="button" onClick={onClose}>Оставить {current}</button>
  </dialog>;
}
