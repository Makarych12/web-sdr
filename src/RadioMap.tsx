import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./radioMap.css";
import { gateway } from "./gateway";
import {
  distanceKm,
  nearbyRepeaters,
  type Point,
  type Repeater,
} from "./radioMapData";

export function RadioMap({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const [city, setCity] = useState("");
  const [callsign, setCallsign] = useState("");
  const [cities, setCities] = useState<(Point & { label: string })[]>([]);
  const [origin, setOrigin] = useState<Point & { label: string }>();
  const [radius, setRadius] = useState(100);
  const [rows, setRows] = useState<Repeater[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Выберите город или разрешите определение местоположения.",
  );
  const cityLastRequest = useRef(0);
  useEffect(() => {
    alive.current = true;
    dialog.current!.showModal();
    const m = L.map(host.current!, {
      preferCanvas: true,
      zoomControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([48, 25], 5);
    map.current = m;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      maxZoom: 19,
      updateWhenIdle: true,
      keepBuffer: 1,
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    const resize = new ResizeObserver(() =>
      m.invalidateSize({ animate: false }),
    );
    resize.observe(host.current!);
    return () => {
      alive.current = false;
      request.current?.abort();
      resize.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  function startRequest() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    return controller;
  }
  async function load(point: Point & { label: string }) {
    const controller = startRequest();
    setBusy(true);
    setOrigin(point);
    setRows([]);
    setCities([]);
    setMessage("Ищем репитеры в OpenStreetMap…");
    map.current?.setView([point.lat, point.lon], radius > 100 ? 7 : 9);
    layer.current?.clearLayers();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const found = await nearbyRepeaters(point, radius, controller.signal);
      if (controller.signal.aborted) return;
      setRows(found);
      setMessage(
        found.length
          ? `Найдено: ${found.length} · радиус ${radius} км`
          : `В радиусе ${radius} км в OSM нет записей. Каталог неполный — это не означает отсутствие репитеров.`,
      );
      const originLabel = document.createElement("span");
      originLabel.textContent = point.label;
      L.circleMarker([point.lat, point.lon], {
        radius: 8,
        color: "#ffcf75",
        fillOpacity: 0.8,
      })
        .bindTooltip(originLabel)
        .addTo(layer.current!);
      found.slice(0, 250).forEach((row) => {
        const popup = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = row.callsign;
        popup.append(title);
        for (const text of [
          row.name,
          `Частота: ${row.frequency}`,
          `Сдвиг: ${row.shift}`,
          `Тоны: ${row.tones}`,
          `${distanceKm(point, row).toFixed(1)} км по прямой`,
        ]) {
          const line = document.createElement("p");
          line.textContent = text;
          popup.append(line);
        }
        const source = document.createElement("a");
        source.href = row.source;
        source.target = "_blank";
        source.rel = "noreferrer";
        source.textContent = "Запись в OpenStreetMap ↗";
        popup.append(source);
        L.circleMarker([row.lat, row.lon], {
          radius: 7,
          color: "#69fff1",
          weight: 2,
          fillColor: "#0a8f96",
          fillOpacity: 0.85,
        })
          .bindPopup(popup)
          .addTo(layer.current!);
      });
    } catch (error) {
      if (alive.current && request.current === controller)
        setMessage(
          controller.signal.aborted
            ? "Время ожидания истекло. Повторите поиск."
            : (error as Error).message,
        );
    } finally {
      clearTimeout(timeout);
      if (alive.current && request.current === controller) setBusy(false);
    }
  }
  async function searchCity(event: React.FormEvent) {
    event.preventDefault();
    if (city.trim().length < 2 || Date.now() - cityLastRequest.current < 1100)
      return;
    cityLastRequest.current = Date.now();
    const controller = startRequest();
    setBusy(true);
    setCities([]);
    setMessage("Ищем город…");
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
          q: city.trim(),
          format: "jsonv2",
          limit: "5",
          "accept-language": "ru",
          featureType: "city",
        })}`,
        { signal: controller.signal, credentials: "omit" },
      );
      if (!response.ok) throw new Error("Поиск города временно недоступен.");
      const data = await response.json();
      if (controller.signal.aborted) return;
      const choices = data
        .map((c: { lat: string; lon: string; display_name: string }) => ({
          lat: Number(c.lat),
          lon: Number(c.lon),
          label: c.display_name,
        }))
        .filter((c: Point) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
      setCities(choices);
      setMessage(
        choices.length
          ? "Выберите город из результатов."
          : "Город не найден. Уточните название и страну.",
      );
    } catch (error) {
      if (alive.current && request.current === controller)
        setMessage(
          controller.signal.aborted
            ? "Время ожидания истекло. Повторите поиск."
            : (error as Error).message,
        );
    } finally {
      clearTimeout(timeout);
      if (alive.current && request.current === controller) setBusy(false);
    }
  }
  function locate() {
    if (!navigator.geolocation) {
      setMessage("Геолокация недоступна. Выберите город вручную.");
      return;
    }
    setMessage("Ожидаем разрешение на геолокацию…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (alive.current)
          void load({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            label: "Моё местоположение",
          });
      },
      () => {
        if (alive.current)
          setMessage("Местоположение не получено. Выберите город вручную.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }
  async function findCorrespondent(event: React.FormEvent) {
    event.preventDefault();
    const call = callsign.trim().toUpperCase();
    if (!/^[A-Z0-9/]{3,20}$/.test(call)) return;
    const controller = startRequest();
    setBusy(true);
    setMessage("Проверяем координаты QTH корреспондента…");
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(
        `${gateway.http}/api/callsign/${encodeURIComponent(call)}`,
        { signal: controller.signal },
      );
      const data = await response.json();
      if (controller.signal.aborted) return;
      const p = data.coordinates;
      if (
        !response.ok ||
        data.status !== "found" ||
        !data.callsign ||
        !["QRZ", "HamQTH", "Callook", "HamDB"].includes(data.source) ||
        !p ||
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lon) ||
        Math.abs(p.lat) > 90 ||
        Math.abs(p.lon) > 180
      ) {
        setMessage(
          "Подтверждённые координаты QTH не получены. Маркер не добавлен.",
        );
        return;
      }
      const popup = document.createElement("div");
      popup.textContent = `${data.callsign} · QTH из ${data.source}${data.retrievedAt ? ` · получено ${data.retrievedAt}` : ""}. Это адрес из каталога, не текущее положение в эфире.${origin ? ` ${distanceKm(origin, p).toFixed(1)} км по прямой.` : ""}`;
      L.circleMarker([p.lat, p.lon], {
        radius: 9,
        color: "#e1a5ff",
        fillColor: "#9948cb",
        fillOpacity: 0.85,
      })
        .bindPopup(popup)
        .addTo(layer.current!)
        .openPopup();
      map.current?.setView([p.lat, p.lon], 10);
      setMessage(`Добавлен QTH ${data.callsign} · источник: ${data.source}.`);
    } catch {
      if (alive.current && request.current === controller)
        setMessage("Координаты корреспондента недоступны. Попробуйте позже.");
    } finally {
      clearTimeout(timeout);
      if (alive.current && request.current === controller) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="radio-map-dialog"
      aria-labelledby="radio-map-title"
      onCancel={close}
      onClose={close}
    >
      <header className="radio-map-header">
        <div>
          <small>UR4MTN · RADIO EXPLORER</small>
          <h2 id="radio-map-title">Карта репитеров</h2>
        </div>
        <button type="button" onClick={close} aria-label="Закрыть карту">
          ✕
        </button>
      </header>
      <div className="radio-map-tools">
        <form onSubmit={searchCity}>
          <input
            aria-label="Город и страна"
            placeholder="Город, страна"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            minLength={2}
            maxLength={150}
            required
          />
          <button disabled={busy}>Найти город</button>
        </form>
        <button type="button" onClick={locate} disabled={busy}>
          ⌖ Моё местоположение
        </button>
        <label>
          Радиус{" "}
          <select
            value={radius}
            onChange={(event) => setRadius(Number(event.target.value))}
          >
            <option value={50}>50 км</option>
            <option value={100}>100 км</option>
            <option value={250}>250 км</option>
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const center = map.current!.getCenter();
            void load({
              lat: center.lat,
              lon: center.lng,
              label: "Выбранный центр карты",
            });
          }}
        >
          Искать в центре карты
        </button>
        <form onSubmit={findCorrespondent}>
          <input
            aria-label="Позывной корреспондента"
            placeholder="Позывной корреспондента"
            value={callsign}
            onChange={(event) => setCallsign(event.target.value)}
            pattern="[A-Za-z0-9/]{3,20}"
            required
            maxLength={20}
          />
          <button disabled={busy}>Показать QTH</button>
        </form>
      </div>
      <div className="radio-map-message" role="status">
        {message}
      </div>
      {cities.length > 0 && (
        <div className="radio-map-cities">
          {cities.map((c, i) => (
            <button key={i} onClick={() => void load(c)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="radio-map-body">
        <div
          ref={host}
          className="radio-map-canvas"
          aria-label="Интерактивная карта репитеров"
        />
        {rows.length > 0 && origin && (
          <aside className="radio-map-list" aria-label="Ближайшие репитеры">
            {rows.slice(0, 250).map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  map.current?.setView([r.lat, r.lon], 12);
                  layer.current?.eachLayer((marker) => {
                    if (
                      marker instanceof L.CircleMarker &&
                      marker.getLatLng().equals([r.lat, r.lon])
                    )
                      marker.openPopup();
                  });
                }}
              >
                <strong>{r.callsign}</strong>
                <span>
                  {distanceKm(origin, r).toFixed(1)} км · {r.frequency}
                </span>
              </button>
            ))}
          </aside>
        )}
      </div>
      <footer className="radio-map-note">
        {origin && <span>Отсчёт расстояний: {origin.label}. </span>}
        Данные:{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap, ODbL
        </a>{" "}
        · Overpass API · поиск городов: Nominatim.
        <span>
          {" "}
          Каталог неполный; параметры и актуальность уточняйте у владельца
          репитера. Показаны до 250 ближайших записей. QTH корреспондента
          добавляется по позывному только при наличии координат из каталога; это
          не текущее положение в эфире.
        </span>
      </footer>
    </dialog>
  );
}
