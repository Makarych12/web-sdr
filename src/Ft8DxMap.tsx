import { useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  FT8_BANDS,
  maidenhead,
  stations,
  bandLabel,
  type MonitorRow,
} from "./ft8Monitor";

export default function Ft8DxMap({
  rows,
  initialBand,
  onStation,
  onClose,
  receiverName,
}: {
  rows: MonitorRow[];
  initialBand: string;
  onStation: (row: MonitorRow) => void;
  onClose: () => void;
  receiverName: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layer = useRef<L.LayerGroup | null>(null);
  const [band, setBand] = useState(initialBand),
    [country, setCountry] = useState(""),
    [cq, setCq] = useState(false),
    [receiverGrid, setReceiverGrid] = useState(""),
    [lines, setLines] = useState(false),
    [zoomVersion, setZoomVersion] = useState(0);
  useEffect(() => {
    setReceiverGrid("");
    setLines(false);
  }, [receiverName]);
  const countries = useMemo(
    () =>
      [
        ...new Map(rows.map((r) => [r.country.id, r.country.name])).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1], "ru")),
    [rows],
  );
  const points = useMemo(
    () =>
      stations(
        rows.filter(
          (r) =>
            (!band || r.band === band) &&
            (!country || r.country.id === country) &&
            (!cq || ["cq", "cqdx", "region"].includes(r.kind)),
        ),
      ),
    [rows, band, country, cq],
  );
  useEffect(() => {
    const m = L.map(host.current!, { preferCanvas: true }).setView([35, 15], 2);
    map.current = m;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      updateWhenIdle: true,
      keepBuffer: 1,
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    const zoom = () => setZoomVersion((v) => v + 1);
    m.on("zoomend", zoom);
    const resize = new ResizeObserver(() =>
      m.invalidateSize({ animate: false }),
    );
    resize.observe(host.current!);
    return () => {
      resize.disconnect();
      m.off("zoomend", zoom);
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current,
      l = layer.current;
    if (!m || !l) return;
    l.clearLayers();
    const origin = maidenhead(receiverGrid),
      groups = new Map<string, MonitorRow[]>();
    for (const r of points) {
      const p = maidenhead(r.locator)!;
      const projected = m.project([p.lat, p.lon], m.getZoom());
      const key = `${Math.floor(projected.x / 50)}:${Math.floor(projected.y / 50)}`;
      const group = groups.get(key) ?? [];
      group.push(r);
      groups.set(key, group);
    }
    if (origin)
      L.circleMarker([origin.lat, origin.lon], {
        radius: 9,
        color: "#ffcd72",
        fillOpacity: 1,
      })
        .bindTooltip(
          `Приёмник: ${receiverName} · ${receiverGrid.toUpperCase()} (указан вручную)`,
        )
        .addTo(l);
    let lineCount = 0;
    for (const group of groups.values()) {
      const r = group[0],
        p = maidenhead(r.locator)!;
      if (group.length > 1) {
        const coords = group.map((r) => {
          const g = maidenhead(r.locator)!;
          return L.latLng(g.lat, g.lon);
        });
        const center = L.latLngBounds(coords).getCenter();
        const icon = L.divIcon({
          className: "ft8-map-cluster",
          html: `<span>${group.length}</span>`,
          iconSize: [36, 36],
        });
        const marker = L.marker(center, { icon }).addTo(l);
        const content = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `${group.length} принятых станций / локаторов`;
        content.append(title);
        const zoomButton = document.createElement("button");
        zoomButton.textContent = "Приблизить";
        zoomButton.onclick = () =>
          m.fitBounds(L.latLngBounds(coords), {
            maxZoom: Math.min(19, m.getZoom() + 3),
            padding: [35, 35],
          });
        content.append(zoomButton);
        for (const item of group.slice(0, 15)) {
          const b = document.createElement("button");
          b.textContent = `${item.call} · ${item.locator} · ${bandLabel(item.band)}`;
          b.onclick = () => onStation(item);
          content.append(b);
        }
        marker.bindPopup(content);
      } else {
        const color = ["cq", "cqdx", "region"].includes(r.kind)
          ? "#49f1b4"
          : r.kind === "end"
            ? "#ffd179"
            : "#65c7ff";
        const marker = L.circleMarker([p.lat, p.lon], {
          radius: 7,
          color,
          fillColor: color,
          fillOpacity: 0.75,
          weight: 2,
        }).addTo(l);
        const content = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = r.call;
        content.append(title);
        for (const text of [
          r.country.name,
          `${r.locator} · ${bandLabel(r.band)} · ${new Date(r.utc).toISOString().slice(11, 19)} UTC`,
          `SNR ≈${r.snr.toFixed(0)} dB`,
          r.message,
          "Центр области локатора, не точный адрес.",
        ]) {
          const p = document.createElement("p");
          p.textContent = text;
          content.append(p);
        }
        const button = document.createElement("button");
        button.textContent = "Карточка станции";
        button.onclick = () => onStation(r);
        content.append(button);
        marker.bindPopup(content);
      }
      if (lines && origin && lineCount < 150) {
        for (const item of group) {
          if (lineCount++ >= 150) break;
          const g = maidenhead(item.locator)!;
          if (Math.abs(origin.lon - g.lon) <= 180)
            L.polyline(
              [
                [origin.lat, origin.lon],
                [g.lat, g.lon],
              ],
              {
                color: "#49cfc2",
                opacity: 0.22,
                weight: 1,
                interactive: false,
              },
            ).addTo(l);
        }
      }
    }
  }, [points, receiverGrid, receiverName, lines, zoomVersion, onStation]);
  return (
    <section className="ft8-dx-map" aria-label="FT8 DX MAP">
      <div className="ft8-map-head">
        <div>
          <small>GRID LOCATOR EXPLORER</small>
          <h3>
            FT8 DX MAP <span>{points.length} локаторов</span>
          </h3>
        </div>
        <button onClick={onClose}>Закрыть карту</button>
      </div>
      <div className="ft8-tools">
        <label>
          Диапазон{" "}
          <select
            aria-label="Диапазон FT8 карты"
            value={band}
            onChange={(e) => setBand(e.target.value)}
          >
            <option value="">Все диапазоны</option>
            {[...FT8_BANDS.map((b) => b[0]), "other"].map((b) => (
              <option key={b} value={b}>
                {bandLabel(b)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Страна{" "}
          <select
            aria-label="Страна FT8 карты"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="">Все страны</option>
            {countries.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={cq}
            onChange={(e) => setCq(e.target.checked)}
          />{" "}
          Только CQ
        </label>
      </div>
      <div className="ft8-map-origin">
        <label>
          Локатор принимающего KiwiSDR{" "}
          <input
            aria-label="Локатор принимающего KiwiSDR"
            placeholder="Например JO44"
            maxLength={6}
            value={receiverGrid}
            onChange={(e) => setReceiverGrid(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          <input
            type="checkbox"
            disabled={!maidenhead(receiverGrid)}
            checked={lines}
            onChange={(e) => setLines(e.target.checked)}
          />{" "}
          Условные линии (до 150)
        </label>
      </div>
      <div ref={host} className="ft8-map-canvas" />
      <p>
        Только локаторы из декодированных сообщений. Маркеры объединяются при
        сближении на экране; раскройте группу для выбора станции. Координаты
        KiwiSDR не предоставлены каталогом — локатор приёмника можно указать
        вручную. Линии не подтверждают установленную связь.
      </p>
    </section>
  );
}
