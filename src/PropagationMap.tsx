import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { maidenhead, type History } from "./ft8Monitor";
import { useStoredState } from "./storage";
import type { DxFeed } from "./useDxCluster";
import {
  pathFrom,
  propagationPoints,
  solarPosition,
  type PropagationPoint,
} from "./propagation";

class Grayline extends L.GridLayer {
  constructor(private utc: number) {
    super({
      tileSize: 256,
      opacity: 1,
      updateWhenIdle: true,
      keepBuffer: 1,
      attribution:
        'Grayline: <a href="https://gml.noaa.gov/grad/solcalc/solareqns.PDF" target="_blank" rel="noreferrer">NOAA equations</a>',
    });
  }
  update(utc: number) {
    this.utc = utc;
    this.redraw();
  }
  createTile(coords: L.Coords) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const small = document.createElement("canvas");
    small.width = small.height = 64;
    const ctx = small.getContext("2d")!,
      pixels = ctx.createImageData(64, 64),
      sun = solarPosition(this.utc),
      rad = Math.PI / 180,
      world = 256 * 2 ** coords.z;
    for (let y = 0; y < 64; y++) {
      const lat = Math.atan(
        Math.sinh(
          Math.PI * (1 - (2 * (coords.y * 256 + (y + 0.5) * 4)) / world),
        ),
      );
      for (let x = 0; x < 64; x++) {
        const lon = ((coords.x * 256 + (x + 0.5) * 4) / world) * 360 - 180;
        const dot =
            Math.sin(lat) * Math.sin(sun.declination) +
            Math.cos(lat) *
              Math.cos(sun.declination) *
              Math.cos((lon - sun.longitude) * rad),
          i = (y * 64 + x) * 4;
        const edge = Math.max(0, 1 - Math.abs(dot) / Math.sin(2 * rad));
        if (edge > 0) {
          pixels.data[i] = 243;
          pixels.data[i + 1] = 189;
          pixels.data[i + 2] = 95;
          pixels.data[i + 3] = Math.round(edge * 130);
        } else if (dot < 0) {
          pixels.data[i] = 3;
          pixels.data[i + 1] = 10;
          pixels.data[i + 2] = 30;
          pixels.data[i + 3] = 90;
        }
      }
    }
    ctx.putImageData(pixels, 0, 0);
    canvas.getContext("2d")!.drawImage(small, 0, 0, 256, 256);
    return canvas;
  }
}
export default function PropagationMap({
  feed,
  history,
  onClose,
}: {
  feed: DxFeed;
  history: MutableRefObject<History>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    host = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    markers = useRef<L.LayerGroup | null>(null),
    grayline = useRef<Grayline | null>(null);
  const [grid, setGrid] = useStoredState(
    "ur4mtn.operatorGrid.v1",
    "",
    (v): v is string => typeof v === "string" && (!v || !!maidenhead(v)),
  );
  const [draft, setDraft] = useState(grid),
    [now, setNow] = useState(Date.now()),
    [points, setPoints] = useState<PropagationPoint[]>([]),
    [missing, setMissing] = useState(0),
    [showDx, setShowDx] = useState(true),
    [showFt8, setShowFt8] = useState(true);
  const latest = useRef({ feed, showDx, showFt8 });
  latest.current = { feed, showDx, showFt8 };
  useEffect(() => {
    dialog.current!.showModal();
    const m = L.map(host.current!, {
      preferCanvas: true,
      worldCopyJump: true,
      minZoom: 1,
      maxZoom: 12,
    }).setView([25, 0], 2);
    map.current = m;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      keepBuffer: 1,
      updateWhenIdle: true,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(m);
    grayline.current = new Grayline(Date.now()).addTo(m);
    markers.current = L.layerGroup().addTo(m);
    const resize = new ResizeObserver(() =>
      m.invalidateSize({ animate: false }),
    );
    resize.observe(host.current!);
    let previousHistory: History | null = null;
    let previousSpots: typeof feed.spots | null = null;
    let ageBucket = -1;
    const update = () => {
      if (document.hidden) return;
      const utc = Date.now();
      setNow(utc);
      if (
        previousHistory === history.current &&
        previousSpots === latest.current.feed.spots &&
        ageBucket === Math.floor(utc / 30000)
      )
        return;
      previousHistory = history.current;
      previousSpots = latest.current.feed.spots;
      ageBucket = Math.floor(utc / 30000);
      const result = propagationPoints(
        history.current,
        latest.current.feed.spots,
        utc,
      );
      setMissing(result.missing);
      setPoints(result.points);
    };
    update();
    const timer = setInterval(update, 5000),
      solarTimer = setInterval(
        () => grayline.current?.update(Date.now()),
        60000,
      );
    return () => {
      clearInterval(timer);
      clearInterval(solarTimer);
      resize.disconnect();
      m.remove();
      map.current = null;
      markers.current = null;
      grayline.current = null;
    };
  }, [history]);
  const origin = maidenhead(grid),
    visible = points
      .filter((p) => (p.source === "DX" ? showDx : showFt8))
      .slice(0, 500);
  const pathLabel = (p: PropagationPoint) => {
    const start = maidenhead(grid);
    if (!start) return "Укажите локатор оператора для расстояния и азимута";
    const path = pathFrom(start, p);
    return `≈ ${Math.round(path.km)} км · ${path.bearing === null ? "азимут не определён" : `${Math.round(path.bearing)}° от севера`}`;
  };
  useEffect(() => {
    const layer = markers.current;
    if (!layer) return;
    layer.clearLayers();
    if (origin)
      L.circleMarker([origin.lat, origin.lon], {
        radius: 9,
        color: "#ffe3a1",
        fillOpacity: 1,
      })
        .bindTooltip(`Оператор · ${grid}`)
        .addTo(layer);
    for (const p of visible) {
      const content = document.createElement("div");
      for (const text of [
        `${p.source} · ${p.call}`,
        `${p.grid} · ${(p.frequency / 1000).toFixed(6)} MHz`,
        pathLabel(p),
        `${new Date(p.utc).toISOString().slice(11, 19)} UTC`,
        p.source === "DX"
          ? "Координаты сопоставлены по позывному с локатором FT8."
          : "Локатор из реально декодированного FT8-сообщения.",
        "Центр области локатора, не точный адрес.",
      ]) {
        const line = document.createElement("p");
        line.textContent = text;
        content.append(line);
      }
      const color = p.source === "DX" ? "#ffa953" : "#3de5b5";
      L.circleMarker([p.lat, p.lon], {
        radius: p.source === "DX" ? 11 : 7,
        color,
        fillColor: color,
        fillOpacity: 0.6,
        weight: 2,
      })
        .bindPopup(content)
        .addTo(layer);
    }
  }, [points, grid, showDx, showFt8]);
  return createPortal(
    <dialog
      ref={dialog}
      className="propagation-panel"
      aria-label="DX PROPAGATION MAP"
      onCancel={onClose}
      onClose={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <div>
          <small>UTC GRAYLINE · OBSERVED DX</small>
          <h2>DX PROPAGATION MAP</h2>
        </div>
        <button
          type="button"
          aria-label="Закрыть карту прохождения"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="propagation-tools">
        <label>
          Локатор оператора
          <input
            aria-label="Локатор оператора"
            value={draft}
            maxLength={6}
            placeholder="Например KN29"
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              setDraft(v);
              if (!v || maidenhead(v)) setGrid(v);
            }}
            aria-invalid={!!draft && !maidenhead(draft)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={showDx}
            onChange={(e) => setShowDx(e.target.checked)}
          />
          DX Cluster
        </label>
        <label>
          <input
            type="checkbox"
            checked={showFt8}
            onChange={(e) => setShowFt8(e.target.checked)}
          />
          FT8
        </label>
        <time>
          {new Date(now).toISOString().slice(0, 19).replace("T", " ")} UTC
        </time>
      </div>
      <div className="propagation-map" ref={host} />
      <p className="propagation-count">
        На карте: {visible.length}
        {points.length > 500 ? " (до 500)" : ""} · DX без известных координат:{" "}
        {missing}. Последние 30 минут. FT8 появляется после запуска
        существующего декодера.
      </p>
      {feed.error && <p role="status">{feed.error}</p>}
      <p>
        Grayline — геометрическая граница дня и ночи по UTC часов устройства,
        обновление раз в минуту. Солнечные формулы NOAA; рефракция не учтена.
        Это не точный прогноз прохождения и не подтверждение радиосвязи.
        DX-координаты используются только при совпадении позывного с известным
        FT8-локатором; центры стран не подставляются.
      </p>
      {draft && !maidenhead(draft) && (
        <p role="alert">
          Нужен локатор из 4 или 6 знаков. Пока применяется предыдущий
          корректный локатор: {grid || "не задан"}.
        </p>
      )}
      <div className="propagation-stations">
        {visible.slice(0, 100).map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => map.current?.setView([p.lat, p.lon], 5)}
          >
            <strong>
              {p.source} · {p.call}
            </strong>
            <span>
              {p.grid} · {pathLabel(p)}
            </span>
          </button>
        ))}
      </div>
    </dialog>,
    document.body,
  );
}
