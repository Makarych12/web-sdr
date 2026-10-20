import React, { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import "./style.css";
import "./brand.css";
import "./console.css";
import "./features.css";
import "./control-panel.css";
import {
  parseFrequency,
  MODE_STEP,
  filterPreset,
  validCuts,
  type Cuts,
  type Preset,
} from "./tuning";
import { FrequencyDigits } from "./FrequencyDigits";
import { FrequencyNudges } from "./FrequencyNudges";
import { VfoDial } from "./VfoDial";
import { FineTune } from "./FineTune";
import { StepControl } from "./StepControl";
import { Antenna, Landing, BandSelector, QslCard } from "./Landing";
import { gateway, gatewayConfigured } from "./gateway";

import { QuickTune } from "./QuickTune";
import { ReceiverPicker, type Receiver } from "./ReceiverPicker";
import {
  useStoredState,
  readStored,
  stringList,
  finiteNumber,
} from "./storage";
import {
  StreamConnection,
  type ConnectionState,
  type KiwiEvent,
} from "./connection";
import { useSpectrumGesture } from "./useSpectrumGesture";
import { SpectrumRenderer } from "./spectrumRenderer";
import { RadioMapLauncher } from "./RadioMapLauncher";
import {
  viewFor,
  sameView,
  matchesRequest,
  frequencyLabel,
  filterPosition,
} from "./spectrumView";
import { directEndpoint } from "./transport";
import { DirectKiwiSocket } from "./directKiwi";
import { RadioMedia } from "./radioMedia";
import { SMeter } from "./SMeter";
import { type Mode, DEFAULT_WIDTHS, FILTER_WIDTHS, passband } from "./radio";
type SavedFrequency = {
  id: string;
  frequency: number;
  mode: Mode;
  width?: number;
  cuts?: Cuts;
};
const savedFrequencies = (v: unknown): v is SavedFrequency[] =>
  Array.isArray(v) &&
  v.length <= 1000 &&
  v.every(
    (x) =>
      x &&
      typeof x.id === "string" &&
      Number.isFinite(x.frequency) &&
      x.frequency >= 0 &&
      x.frequency <= 30000 &&
      ["AM", "USB", "LSB", "CW", "FM"].includes(x.mode) &&
      (x.cuts === undefined || validCuts(x.cuts)) &&
      (x.width === undefined ||
        FILTER_WIDTHS[x.mode as Mode].includes(x.width)),
  );
type View = {
  start: number;
  span: number;
  bandwidth?: number;
  zoom?: number;
  sequence?: number;
};
function App() {
  const [agc, setAgc] = useStoredState<"fast" | "slow" | "off">(
    "wave.agc",
    "slow",
    (v): v is "fast" | "slow" | "off" =>
      ["fast", "slow", "off"].includes(String(v)),
  );
  const debug = new URLSearchParams(location.search).has("debug");
  const [audioDebug, setAudioDebug] = useState<{
    queueMs: number;
    targetMs: number;
    underflowFrames: number;
  } | null>(null);
  const [activeSection, setActiveSection] = useState("home");
  useEffect(() => {
    const update = () => {
      const top =
        (document.querySelector("header")?.getBoundingClientRect().height ??
          84) + 80;
      let active = "home";
      for (const id of ["home", "listen", "favorites", "about"])
        if (
          (document.getElementById(id)?.getBoundingClientRect().top ??
            Infinity) <= top
        )
          active = id;
      // A short final section cannot always reach the sticky header.
      // Keep the requested visible anchor selected at the bottom of the page.
      if (
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 48
      ) {
        const target = location.hash.slice(1);
        const bounds = document.getElementById(target)?.getBoundingClientRect();
        if (
          ["favorites", "about"].includes(target) &&
          bounds &&
          bounds.top < window.innerHeight &&
          bounds.bottom > top
        )
          active = target;
      }
      setActiveSection(active);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);
  const [favoriteServers, setFavoriteServers] = useStoredState(
    "wave.servers",
    [],
    stringList,
  );
  const [favoriteFrequencies, setFavoriteFrequencies] = useStoredState(
    "wave.frequencies",
    [],
    savedFrequencies,
  );
  const [receiver, setReceiver] = useStoredState(
    "wave.receiver",
    "niendorf",
    (v): v is string => typeof v === "string",
  );
  const [receivers, setReceivers] = useState<Receiver[]>([]),
    [frequencyHz, setFrequencyHz] = useStoredState(
      "wave.frequencyHz",
      10000000,
      (v): v is number =>
        Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 30000000,
    ),
    [draft, setDraft] = useState("10000"),
    [mode, setMode] = useStoredState<Mode>("wave.mode", "AM", (v): v is Mode =>
      ["AM", "USB", "LSB", "CW", "FM"].includes(String(v)),
    ),
    [zoom, setZoom] = useStoredState(
      "wave.zoom",
      6,
      (v): v is number =>
        Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 14,
    ),
    [viewCenter, setViewCenter] = useStoredState(
      "wave.center",
      10000,
      (v): v is number => finiteNumber(v) && v >= 0 && v <= 30000,
    ),
    [maxZoom, setMaxZoom] = useState(14),
    [step, setStep] = useStoredState(
      "wave.step",
      0.1,
      (v): v is number =>
        finiteNumber(v) &&
        [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10].includes(v),
    ),
    [status, setStatus] = useState("Готов к эфиру"),
    [connected, setConnected] = useState(false),
    [wanted, setWanted] = useState(false),
    [retryAt, setRetryAt] = useState<number | undefined>(),
    [retryAttempt, setRetryAttempt] = useState(0),
    [clock, setClock] = useState(Date.now()),
    [audioPaused, setAudioPaused] = useState(false),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState(""),
    [rssi, setRssi] = useState<number | null>(null),
    [counts, setCounts] = useState({ audio: 0, wf: 0 }),
    [view, setView] = useState<View>(() =>
      viewFor(
        readStored("wave.center", 10000, finiteNumber),
        readStored(
          "wave.zoom",
          6,
          (v): v is number =>
            Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 14,
        ),
        30000,
      ),
    ),
    [offline, setOffline] = useState(!navigator.onLine);
  const frequency = frequencyHz / 1000; // kHz adapters for the existing view/protocol only.
  const [cuts, setCuts] = useStoredState<Cuts>(
    "wave.cuts",
    filterPreset(mode, "Normal"),
    validCuts,
  );
  const [manualGain, setManualGain] = useStoredState(
    "wave.gain",
    50,
    (v): v is number => finiteNumber(v) && v >= 0 && v <= 120,
  );
  useEffect(() => {
    setDraft(String(frequencyHz / 1000));
  }, [frequencyHz]);
  const [volume, setVolume] = useStoredState(
    "wave.volume",
    0.7,
    (v): v is number => finiteNumber(v) && v >= 0 && v <= 1,
  );
  const [muted, setMuted] = useStoredState(
    "wave.muted",
    false,
    (v): v is boolean => typeof v === "boolean",
  );
  const [widths, setWidths] = useStoredState(
    "wave.filters",
    DEFAULT_WIDTHS,
    (v): v is Record<Mode, number> =>
      !!v &&
      typeof v === "object" &&
      Object.keys(DEFAULT_WIDTHS).every((m) =>
        FILTER_WIDTHS[m as Mode].includes(
          (v as Record<Mode, number>)[m as Mode],
        ),
      ),
  );
  const filterWidth = widths[mode];
  const favoriteServer = useCallback(
    (id: string) => {
      setFavoriteServers((list) =>
        list.includes(id) ? list.filter((v) => v !== id) : [...list, id],
      );
    },
    [setFavoriteServers],
  );
  function favoriteFrequency() {
    const id = `${frequency}-${mode}`;
    setFavoriteFrequencies((list) =>
      list.some((v) => v.id === id)
        ? list.filter((v) => v.id !== id)
        : [...list, { id, frequency, mode, width: filterWidth, cuts }],
    );
  }
  const manager = useRef<StreamConnection | null>(null);
  const receiverRef = useRef(receiver);
  receiverRef.current = receiver;
  const availableReceivers = useRef(receivers);
  availableReceivers.current = receivers;
  const failedReceivers = useRef(new Set<string>());
  const [gatewayFallback, setGatewayFallback] = useState<string[]>([]);
  const gatewayFallbackRef = useRef(new Set<string>());
  const [receiverChange, setReceiverChange] = useState("");
  const [viewPending, setViewPending] = useState(false);
  const renderer = useRef<SpectrumRenderer | null>(null);
  const sourceView = useRef<View | null>(null);
  const awaitingTune = useRef(false);
  const [waterfallReady, setWaterfallReady] = useState(false);
  const requestedView = useRef<View | null>(null);
  const signal = useRef<number | null>(null);
  const callbacks = useRef<{
    message: (v: KiwiEvent | Uint8Array) => void;
    state: (v: ConnectionState) => void;
  }>({ message: () => {}, state: () => {} });
  const context = useRef<AudioContext | null>(null),
    media = useRef<RadioMedia | null>(null),
    player = useRef<AudioWorkletNode | null>(null),
    gain = useRef<GainNode | null>(null),
    spectrum = useRef<HTMLCanvasElement>(null),
    waterfall = useRef<HTMLCanvasElement>(null),
    scale = useRef<HTMLDivElement>(null),
    settings = useRef({
      frequency,
      mode,
      zoom,
      viewCenter,
      agc,
      ...cuts,
      manualGain,
    }),
    stats = useRef({ audio: 0, wf: 0 }),
    initializing = useRef(false),
    startGeneration = useRef(0),
    rate = useRef(12000),
    viewRef = useRef(view),
    calibration = useRef(-13);
  settings.current = {
    frequency,
    mode,
    zoom,
    viewCenter,
    agc,
    ...cuts,
    manualGain,
  };
  useEffect(() => {
    renderer.current = new SpectrumRenderer(
      spectrum.current!,
      waterfall.current!,
      viewRef.current,
    );
    return () => {
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);
  useEffect(() => {
    let disposed = false,
      attempt = 0;
    let catalogTimer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const catalogError =
      "Каталог серверов временно недоступен. Повторяем подключение…";
    async function loadCatalog() {
      if (!gatewayConfigured || disposed) return;
      clearTimeout(catalogTimer);
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch(gateway.http + "/api/receivers", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          throw Error("Gateway API unavailable");
        const rows: Receiver[] = await response.json();
        if (!Array.isArray(rows)) throw Error("Invalid receiver catalog");
        if (disposed || controller.signal.aborted) return;
        attempt = 0;
        setReceivers(rows);
        if (
          !manager.current?.desired && rows.length &&
          !rows.some((r) => r.id === receiverRef.current)
        ) {
          receiverRef.current = rows[0].id;
          setReceiver(rows[0].id);
        }
        setError((current) => (current === catalogError ? "" : current));
      } catch {
        if (disposed || controller.signal.aborted) return;
        setError(catalogError);
        catalogTimer = setTimeout(
          () => void loadCatalog(),
          Math.min(30000, 2000 * 2 ** Math.min(attempt++, 4)),
        );
      }
    }
    if (!gatewayConfigured)
      setError(
        "Приёмник временно недоступен: администратор ещё не подключил шлюз.",
      );
    else void loadCatalog();
    const t = setInterval(() => {
      setCounts((old) =>
        old.audio === stats.current.audio && old.wf === stats.current.wf
          ? old
          : { ...stats.current },
      );
      if (manager.current?.desired) setClock(Date.now());
    }, 1000);
    const online = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) {
        void loadCatalog();
        manager.current?.recoverAfterSleep();
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      disposed = true;
      clearTimeout(catalogTimer);
      request?.abort();
      clearInterval(t);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      ++startGeneration.current;
      manager.current?.stop();
      void context.current?.close();
    };
  }, []);
  useEffect(() => {
    let recovering: Promise<void> | null = null;
    const recover = () => {
      if (!manager.current?.desired) return;
      manager.current.recoverAfterSleep();
      if (!recovering)
        recovering = resumeAudio().finally(() => {
          recovering = null;
        });
    };
    const visible = () => {
      const shown = !document.hidden;
      renderer.current?.setVisible(shown);
      manager.current?.setBackground(!shown);
      if (shown) recover();
    };
    const freeze = () => {
      manager.current?.setBackground(true);
      renderer.current?.setVisible(false);
    };
    const resume = () => {
      visible();
      // Android may unfreeze a page while it is still hidden.
      recover();
    };
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("freeze", freeze);
    document.addEventListener("resume", resume);
    window.addEventListener("pageshow", visible);
    visible();
    return () => {
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("freeze", freeze);
      document.removeEventListener("resume", resume);
      window.removeEventListener("pageshow", visible);
    };
  }, []);
  const mediaActions = useRef({ play: () => {}, pause: () => {} });
  mediaActions.current = {
    play: () => {
      if (!manager.current?.desired) void connect();
      else {
        manager.current.recoverAfterSleep();
        void resumeAudio();
      }
    },
    pause: () => {
      ++startGeneration.current;
      manager.current?.stop();
    },
  };
  useEffect(() => {
    media.current = new RadioMedia();
    media.current.actions(
      () => mediaActions.current.play(),
      () => mediaActions.current.pause(),
    );
    return () => {
      media.current?.dispose();
      media.current = null;
    };
  }, []);
  useEffect(() => {
    media.current?.metadata(
      receivers.find((r) => r.id === receiver)?.name || receiver,
      frequencyHz,
      mode,
    );
  }, [receiver, receivers, frequencyHz, mode]);
  useEffect(() => {
    if (gain.current)
      gain.current.gain.setTargetAtTime(
        muted ? 0 : volume,
        context.current!.currentTime,
        0.025,
      );
  }, [volume, muted]);
  useEffect(() => {
    const timer = setInterval(() => setRssi(signal.current), 100);
    return () => clearInterval(timer);
  }, []);
  function tune(
    f = frequency,
    m = mode,
    z = zoom,
    width = widths[m],
    center?: number,
    customCuts?: Cuts,
  ) {
    f = Math.round(Math.max(0, Math.min(30000, f)) * 1000) / 1000;
    // Fine tuning moves the VFO inside the existing overview. Recenter only
    // when it leaves the usable area, or when an explicit view was requested.
    const currentView = viewRef.current;
    const previous = settings.current;
    const nextCuts =
      customCuts ??
      (m !== previous.mode
        ? filterPreset(m, "Normal")
        : width !== filterWidth
          ? passband(m, width)
          : cuts);
    const immediate =
      m !== previous.mode ||
      nextCuts.lowCut !== previous.lowCut ||
      nextCuts.highCut !== previous.highCut;
    center ??=
      f >= currentView.start + currentView.span * 0.1 &&
      f <= currentView.start + currentView.span * 0.9
        ? settings.current.viewCenter
        : f;
    const nextView = viewFor(center, z, viewRef.current.bandwidth ?? 30000);
    const viewChanged = !matchesRequest(currentView, nextView);
    if (viewChanged) awaitingTune.current = wanted;
    center = nextView.start + nextView.span / 2;
    // Native wheel/pointer handlers can run just before paint. Commit the
    // VFO and filter marker in this event rather than waiting another frame.
    flushSync(() => {
      if (viewChanged) {
        requestedView.current = nextView;
        setViewPending(wanted);
        displayView(nextView);
      }
      setViewCenter(center);
      setFrequencyHz(Math.round(f * 1000));
      setCuts(nextCuts);
      if (m !== previous.mode) setStep(MODE_STEP[m] / 1000);
      setDraft(String(Number(f.toFixed(3))));
      setMode(m);
      setZoom(z);
      setWidths((prev) => (prev[m] === width ? prev : { ...prev, [m]: width }));
    });
    settings.current = {
      frequency: f,
      mode: m,
      zoom: z,
      viewCenter: center,
      agc,
      ...nextCuts,
      manualGain,
    };
    // Keep live PCM and its jitter buffer running through ordinary tuning.
    // Only connection lifecycle resets may discard audio from an old session.
    if (immediate) manager.current?.flushTune();
    else manager.current?.tune();
  }

  function displayView(next: View) {
    if (sameView(viewRef.current, next)) return;
    viewRef.current = next;
    renderer.current?.setView(next);
    setView(next);
  }
  callbacks.current.state = (v) => {
    setWanted(manager.current?.desired ?? false);
    if (v.phase === "idle" || v.phase === "blocked") media.current?.pause();
    if (
      (v.phase === "idle" || v.phase === "blocked") &&
      context.current?.state === "running"
    )
      void context.current.suspend();
    setConnected(v.phase === "live");
    setStatus(v.message);
    setRetryAt(v.retryAt);
    setRetryAttempt(v.attempt);
    if (v.phase === "retrying" || v.phase === "blocked") setError(v.message);
    else if (v.phase === "live") setError("");
  };
  callbacks.current.message = (v) => {
    if (v instanceof Uint8Array) {
      if (v[0] === 1) {
        const dv = new DataView(v.buffer, v.byteOffset, v.byteLength);
        const samples = new Float32Array((v.length - 1) / 2);
        for (let i = 0; i < samples.length; i++)
          samples[i] = dv.getInt16(1 + i * 2, false) / 32768;
        player.current?.port.postMessage({ samples, rate: rate.current }, [
          samples.buffer,
        ]);
        stats.current.audio++;
      } else if (v[0] === 2) {
        stats.current.wf++;
        const incoming = sourceView.current;
        if (
          !awaitingTune.current &&
          incoming &&
          (!requestedView.current ||
            matchesRequest(incoming, requestedView.current)) &&
          renderer.current?.append(v.subarray(1), incoming)
        )
          setWaterfallReady(true);
      }
      return;
    }
    if (v.type === "tuned") {
      const current = settings.current;
      if (
        v.frequency === current.frequency &&
        v.mode === current.mode &&
        v.zoom === current.zoom &&
        (v.viewCenter === undefined || v.viewCenter === current.viewCenter)
      )
        awaitingTune.current = false;
    }
    if (v.type === "audio" && typeof v.sampleRate === "number") {
      rate.current = v.sampleRate;
      player.current?.port.postMessage({ rate: v.sampleRate });
    }
    if (v.type === "limits" && typeof v.maxZoom === "number") {
      const limit = Math.max(0, Math.min(14, v.maxZoom));
      setMaxZoom(limit);
      if (settings.current.zoom > limit)
        changeView(settings.current.viewCenter, limit);
    }
    if (v.type === "signal" && finiteNumber(v.rssi)) signal.current = v.rssi;
    if (v.type === "calibration" && typeof v.value === "number") {
      calibration.current = v.value;
      renderer.current?.setCalibration(v.value);
    }
    if (v.type === "view") {
      // An invalid header must never lend the previous row's metadata to its bytes.
      sourceView.current = null;
      if (
        (v.bandwidth !== undefined &&
          (!finiteNumber(v.bandwidth) || v.bandwidth <= 0)) ||
        (v.zoom !== undefined &&
          (!finiteNumber(v.zoom) ||
            !Number.isInteger(v.zoom) ||
            v.zoom < 0 ||
            v.zoom > 14)) ||
        (v.sequence !== undefined &&
          (!finiteNumber(v.sequence) ||
            !Number.isInteger(v.sequence) ||
            v.sequence < 0 ||
            v.sequence > 0xffffffff))
      )
        return;
    }
    if (
      v.type === "view" &&
      typeof v.start === "number" &&
      Number.isFinite(v.start) &&
      v.start >= 0 &&
      typeof v.span === "number" &&
      Number.isFinite(v.span) &&
      v.span > 0
    ) {
      const incoming = {
        start: v.start,
        span: v.span,
        bandwidth: typeof v.bandwidth === "number" ? v.bandwidth : 30000,
        zoom: typeof v.zoom === "number" ? v.zoom : settings.current.zoom,
        sequence: typeof v.sequence === "number" ? v.sequence : undefined,
      };
      sourceView.current = incoming;
      if (
        requestedView.current &&
        requestedView.current.bandwidth !== incoming.bandwidth
      ) {
        requestedView.current = viewFor(
          settings.current.viewCenter,
          settings.current.zoom,
          incoming.bandwidth,
        );
        displayView(requestedView.current);
      }
      const target =
        requestedView.current ??
        viewFor(
          settings.current.viewCenter,
          settings.current.zoom,
          incoming.bandwidth,
        );
      if (!matchesRequest(incoming, target)) return;
      requestedView.current = null;
      setViewPending(false);
      displayView(incoming);
    }
  };
  if (!manager.current)
    manager.current = new StreamConnection({
      url: gateway.socket,
      getConfig: () => ({ receiver: receiverRef.current, ...settings.current }),
      onState: (v) => callbacks.current.state(v),
      onMessage: (v) => callbacks.current.message(v),
      socketFactory: (url) => {
        const receiver = availableReceivers.current.find(
          (r) => r.id === receiverRef.current,
        );
        const direct = directEndpoint(
          receiver?.directUrl,
          gatewayFallbackRef.current.has(receiverRef.current),
        );
        return direct
          ? (new DirectKiwiSocket(direct) as unknown as WebSocket)
          : new WebSocket(url);
      },
      onDiagnostic: (event) => {
        if (
          event.type === "upstream_error" &&
          event.code === "connection" &&
          event.failures === 2
        ) {
          const id = receiverRef.current;
          if (
            availableReceivers.current.find((r) => r.id === id)?.directUrl &&
            !gatewayFallbackRef.current.has(id)
          ) {
            gatewayFallbackRef.current.add(id);
            setGatewayFallback([...gatewayFallbackRef.current]);
            setReceiverChange(
              "Прямой WSS недоступен. Повторяем этот сервер через шлюз.",
            );
          }
        }
        console.info("WebSDR lifecycle", {
          ...event,
          at: new Date().toISOString(),
        });
      },
      onUnavailable: (_code, reason) => {
        failedReceivers.current.add(receiverRef.current);
        if (failedReceivers.current.size >= 6) return false;
        const frequency = settings.current.frequency;
        const next = availableReceivers.current
          .filter(
            (r) =>
              !failedReceivers.current.has(r.id) &&
              r.apiAvailable &&
              (r.maxUsers ?? 0) > (r.users ?? 0) &&
              frequency >= (r.minFrequency ?? 0) &&
              frequency <= (r.maxFrequency ?? 30000),
          )
          .sort(
            (a, b) =>
              Number(!!b.directUrl) - Number(!!a.directUrl) ||
              (b.snr ?? 0) - (a.snr ?? 0),
          )[0];
        if (!next) return false;
        const previous = availableReceivers.current.find(
          (r) => r.id === receiverRef.current,
        );
        setReceiverChange(
          `${previous?.name || receiverRef.current}: ${reason} После повторного подключения выбран ${next.name}.`,
        );
        renderer.current?.clear();
        receiverRef.current = next.id;
        setReceiver(next.id);
        return true;
      },
      onReset: () => {
        renderer.current?.clear();
        sourceView.current = null;
        awaitingTune.current = true;
        setWaterfallReady(false);
        player.current?.port.postMessage({ reset: true });
        signal.current = null;
        setRssi(null);
      },
    });
  const chooseReceiver = useCallback(
    (id: string) => {
      failedReceivers.current.clear();
      gatewayFallbackRef.current.delete(id);
      setGatewayFallback([...gatewayFallbackRef.current]);
      setReceiverChange("Приёмник выбран вручную");
      renderer.current?.clear();
      requestedView.current = null;
      receiverRef.current = id;
      setReceiver(id);
      setError("");
      manager.current?.switchReceiver();
    },
    [setReceiver],
  );
  async function connect() {
    if (!gatewayConfigured) return;
    if (manager.current?.desired) {
      ++startGeneration.current;
      manager.current.stop();
      return;
    }
    if (initializing.current) return;
    initializing.current = true;
    const generation = ++startGeneration.current;
    setPreparing(true);
    setError("");
    stats.current = { audio: 0, wf: 0 };
    setCounts({ ...stats.current });
    failedReceivers.current.clear();
    manager.current!.start();
    try {
      if (
        !context.current ||
        context.current.state === "closed" ||
        !player.current
      ) {
        if (context.current && context.current.state !== "closed")
          await context.current.close();
        if (generation !== startGeneration.current) return;
        context.current = new AudioContext({ latencyHint: "interactive" });
        void context.current.resume();
        await context.current.audioWorklet.addModule("/audio-worklet.js");
        if (generation !== startGeneration.current) {
          if (context.current.state !== "closed")
            void context.current.suspend();
          return;
        }
        player.current = new AudioWorkletNode(context.current, "pcm-player");
        player.current.port.onmessage = ({ data }) => {
          if (debug && data.type === "playback") setAudioDebug(data);
        };
        gain.current = context.current.createGain();
        gain.current.gain.value = muted ? 0 : volume;
        player.current.connect(gain.current);
        media.current!.attach(context.current, gain.current);
        context.current.onstatechange = () => {
          setAudioPaused(
            context.current?.state !== "running" || !!media.current?.audio.paused,
          );
          if (context.current?.state !== "running")
            media.current?.setState("paused");
        };
      }
      await resumeAudio();
      if (generation !== startGeneration.current || !manager.current?.desired) {
        void context.current.suspend();
        return;
      }
    } catch (e) {
      if (generation !== startGeneration.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Не удалось включить звук");
      manager.current?.stop();
      if (!player.current) {
        await context.current?.close();
        context.current = null;
      }
    } finally {
      initializing.current = false;
      setPreparing(false);
    }
  }
  async function resumeAudio() {
    if (!manager.current?.desired || !context.current || !media.current) return;
    try {
      if (context.current.state !== "running") {
        player.current?.port.postMessage({ reset: true });
        await context.current.resume();
      }
      if (!manager.current?.desired) {
        media.current.pause();
        void context.current.suspend();
        return;
      }
      await media.current.play();
      if (!manager.current?.desired) media.current.pause();
      setAudioPaused(
        context.current.state !== "running" || media.current.audio.paused,
      );
    } catch {
      setAudioPaused(true);
    }
  }
  function changeView(center: number, z = zoom) {
    const bandwidth = viewRef.current.bandwidth ?? 30000;
    z = Math.max(0, Math.min(maxZoom, z));
    const span = bandwidth / 2 ** z;
    center = Math.max(span / 2, Math.min(bandwidth - span / 2, center));
    const next = viewFor(center, z, bandwidth);
    if (matchesRequest(viewRef.current, next)) return;
    setViewCenter(center);
    setZoom(z);
    settings.current = { ...settings.current, zoom: z, viewCenter: center };
    if (!sameView(next, viewRef.current)) {
      // Keep history in its original frequency coordinates.
      awaitingTune.current = wanted;
    }
    requestedView.current = next;
    setViewPending(wanted);
    displayView(next);
    manager.current?.tune();
  }
  function changeZoom(z: number) {
    const current = viewRef.current;
    const f = settings.current.frequency;
    // After zoom 0 the geometric center is half the receiver bandwidth.
    // Zoom controls must still return to the visible VFO, not that midpoint.
    const center =
      f >= current.start && f <= current.start + current.span
        ? f
        : settings.current.viewCenter;
    changeView(center, z);
  }
  const gestureOptions = {
    view,
    zoom: view.zoom ?? zoom,
    maxZoom,
    step,
    frequency,
    cuts,
    onFilter: (next: Cuts) =>
      tune(frequency, mode, zoom, filterWidth, viewCenter, next),
    onTune: (f: number, center: number) =>
      tune(f, mode, zoom, filterWidth, center),
    onView: changeView,
    onEnd: () => manager.current?.flushTune(),
  };
  const spectrumGesture = useSpectrumGesture({
    canvas: spectrum,
    ...gestureOptions,
  });
  const scaleGesture = useSpectrumGesture({
    canvas: scale,
    ...gestureOptions,
  });
  const waterfallGesture = useSpectrumGesture({
    canvas: waterfall,
    ...gestureOptions,
    allowPageScroll: true,
  });
  const marker = Math.max(
    0,
    Math.min(100, ((frequency - view.start) / view.span) * 100),
  );
  const filterBand = filterPosition(view, frequency, cuts.lowCut, cuts.highCut);
  return (
    <div className={"app" + (wanted ? " playing" : "")}>
      <header className="site-header">
        <a className="brand" href="#home" aria-label="UR4MTN WEB SDR — главная">
          <Antenna />
          <span>
            UR4MTN<small>WEB SDR</small>
          </span>
        </a>
        <nav aria-label="Главное меню">
          <a
            href="#home"
            aria-current={activeSection === "home" ? "location" : undefined}
          >
            Главная
          </a>
          <a
            href="#listen"
            aria-current={activeSection === "listen" ? "location" : undefined}
          >
            Слушать
          </a>
          <button
            onClick={() =>
              document
                .querySelector<HTMLButtonElement>(".catalog-open")
                ?.click()
            }
          >
            Серверы
          </button>
          <a
            href="#favorites"
            aria-current={
              activeSection === "favorites" ? "location" : undefined
            }
          >
            Избранное
          </a>
          <a
            href="#about"
            aria-current={activeSection === "about" ? "location" : undefined}
          >
            О проекте
          </a>
        </nav>
        <div className="header-right" role="status">
          <span className={"dot " + (connected ? "live" : "")} />
          {offline
            ? "Нет сети"
            : retryAt
              ? "Переподключение…"
              : error && !wanted
                ? "Ошибка"
                : connected
                  ? "ONLINE · В эфире"
                  : status}
        </div>
      </header>
      <main>
        <Landing
          disabled={
            offline || preparing || !gatewayConfigured || !receivers.length
          }
          listen={() => {
            if (!wanted) void connect();
            document
              .getElementById("listen")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
        />
        <div id="listen" className="section-heading">
          <div>
            <span className="eyebrow">UR4MTN · LIVE RECEIVER</span>
            <h2>Слушать эфир</h2>
          </div>
          <p>Выберите приёмник и найдите свою частоту.</p>
        </div>
        <section className="receiver panel">
          <ReceiverPicker
            receivers={receivers}
            selected={receiver}
            favorites={favoriteServers}
            choose={chooseReceiver}
            favorite={favoriteServer}
            disabled={preparing}
          />
          <button
            className={"connect " + (wanted ? "stop" : "")}
            onClick={() => void connect()}
            disabled={
              (!wanted &&
                (offline || !gatewayConfigured || !receivers.length)) ||
              (!wanted && preparing)
            }
          >
            {" "}
            {wanted ? "■ Отключиться" : "▶ Слушать эфир"}
          </button>
        </section>
        <div className="receiver-status" role="status">
          <strong>
            {receivers.find((r) => r.id === receiver)?.name || receiver}
          </strong>
          <span>
            {connected ? "Играет" : wanted ? "Подключение" : "Выбран"} ·{" "}
            {receivers.find((r) => r.id === receiver)?.directUrl &&
            !gatewayFallback.includes(receiver)
              ? "Прямой WSS Kiwi"
              : "Через шлюз · восстановление каждые 5 минут"}
          </span>
          {receiverChange && <small>{receiverChange}</small>}
        </div>
        {wanted && retryAt && (
          <div className="reconnect-banner" role="status">
            <span>
              Переподключение через{" "}
              {Math.max(0, Math.ceil((retryAt - clock) / 1000))} с · попытка{" "}
              {retryAttempt}
            </span>
            <button onClick={() => manager.current?.reconnectNow()}>
              Повторить сейчас
            </button>
          </div>
        )}
        {wanted && audioPaused && (
          <div className="reconnect-banner">
            <span>Браузер приостановил звук</span>
            <button onClick={() => void resumeAudio()}>
              Возобновить звук
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <section
          className={"control-panel panel" + (connected ? " receiving" : "")}
          onKeyDown={(e) => {
            if (
              e.defaultPrevented ||
              (e.target as HTMLElement).matches("input, select, textarea")
            )
              return;
            if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(e.key)) {
              e.preventDefault();
              tune(
                frequency +
                  (["ArrowRight", "PageUp"].includes(e.key) ? 1 : -1) *
                    step *
                    (e.key.startsWith("Page") ? 10 : 1),
              );
              manager.current?.flushTune();
            }
          }}
        >
          <div className="tuner">
            <div className="frequency">
              <label htmlFor="frequency">ЧАСТОТА · VFO A</label>
              <FrequencyDigits
                hz={frequencyHz}
                stepHz={Math.round(step * 1000)}
                onTune={(hz) => {
                  tune(hz / 1000);
                  manager.current?.flushTune();
                }}
              />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const hz = parseFrequency(draft);
                  if (hz !== null) {
                    tune(hz / 1000);
                    manager.current?.flushTune();
                  } else setError("Введите частоту от 0 до 30000 кГц");
                }}
              >
                <input
                  id="frequency"
                  aria-label="Частота кГц"
                  onKeyDown={(e) => {
                    if (
                      ["ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(
                        e.key,
                      )
                    ) {
                      e.preventDefault();
                      tune(
                        frequency +
                          (["ArrowRight", "PageUp"].includes(e.key) ? 1 : -1) *
                            step *
                            (e.key.startsWith("Page") ? 10 : 1),
                      );
                      manager.current?.flushTune();
                    }
                  }}
                  inputMode="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.replace(",", "."))}
                />
                <span>kHz</span>
              </form>
              <FrequencyNudges
                onNudge={(deltaHz) => {
                  tune(Math.max(0, Math.min(30000000, frequencyHz + deltaHz)) / 1000);
                  manager.current?.flushTune();
                }}
              />
            </div>
            <VfoDial
              frequencyHz={frequencyHz}
              stepHz={Math.round(step * 1000)}
              onTune={(hz) => tune(hz / 1000)}
              onEnd={() => manager.current?.flushTune()}
            />
            <SMeter rssi={rssi} />
            <div
              className="signal-settings"
              role="group"
              aria-label="Настройки сигнала"
            >
              <div className="agc-control">
                <label htmlFor="agc">AGC</label>
                <select
                  id="agc"
                  value={agc}
                  onChange={(e) => {
                    const value = e.target.value as typeof agc;
                    setAgc(value);
                    settings.current = { ...settings.current, agc: value };
                    manager.current?.flushTune();
                  }}
                >
                  <option value="slow">Медленная</option>
                  <option value="fast">Быстрая</option>
                  <option value="off">Выкл.</option>
                </select>
              </div>
              {agc === "off" && (
                <label>
                  Gain {manualGain}
                  <input
                    aria-label="Ручной Gain"
                    type="range"
                    min="0"
                    max="120"
                    value={manualGain}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setManualGain(value);
                      settings.current = {
                        ...settings.current,
                        manualGain: value,
                      };
                      manager.current?.flushTune();
                    }}
                  />
                </label>
              )}
              <div className="volume panel">
                <button
                  aria-label={muted ? "Включить звук" : "Выключить звук"}
                  onClick={() => setMuted(!muted)}
                >
                  {muted ? "◌" : "◖))"}
                </button>
                <label htmlFor="volume">Громкость</label>
                <input
                  id="volume"
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
                <span>{muted ? "MUTE" : Math.round(volume * 100) + "%"}</span>
              </div>
            </div>
          </div>
          <div className="steps">
            <StepControl step={step} onChange={setStep} />
            <button
              aria-label="Избранная частота"
              aria-pressed={favoriteFrequencies.some(
                (v) => v.id === `${frequency}-${mode}`,
              )}
              onClick={favoriteFrequency}
            >
              {favoriteFrequencies.some((v) => v.id === `${frequency}-${mode}`)
                ? "★ Сохранено"
                : "☆ Сохранить"}
            </button>
            <button
              aria-label="Шаг частоты вниз"
              onClick={() => tune(frequency - step)}
            >
              − {step * 1000} Hz
            </button>
            <button
              aria-label="Шаг частоты вверх"
              onClick={() => tune(frequency + step)}
            >
              + {step * 1000} Hz
            </button>
          </div>
          <div className="mode" role="group" aria-label="Режим и полоса">
            <label>РЕЖИМ И ПОЛОСА</label>
            <div className="modes">
              {(["AM", "USB", "LSB", "CW", "FM"] as Mode[]).map((m) => (
                <button
                  key={m}
                  className={mode === m ? "selected" : ""}
                  onClick={() => tune(frequency, m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="filter-presets">
              {(["Narrow", "Normal", "Wide"] as Preset[]).map((p) => (
                <button
                  key={p}
                  aria-pressed={
                    cuts.lowCut === filterPreset(mode, p).lowCut &&
                    cuts.highCut === filterPreset(mode, p).highCut
                  }
                  onClick={() =>
                    tune(
                      frequency,
                      mode,
                      zoom,
                      filterWidth,
                      viewCenter,
                      filterPreset(mode, p),
                    )
                  }
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="filter-control">
              <label>
                Левая граница{" "}
                <input
                  aria-label="Левая граница фильтра"
                  type="number"
                  min="-6000"
                  max={cuts.highCut - 50}
                  value={cuts.lowCut}
                  onChange={(e) => {
                    const next = { ...cuts, lowCut: Number(e.target.value) };
                    if (validCuts(next))
                      tune(frequency, mode, zoom, filterWidth, viewCenter, next);
                  }}
                />
              </label>
              <label>
                Правая граница{" "}
                <input
                  aria-label="Правая граница фильтра"
                  type="number"
                  min={cuts.lowCut + 50}
                  max="6000"
                  value={cuts.highCut}
                  onChange={(e) => {
                    const next = { ...cuts, highCut: Number(e.target.value) };
                    if (validCuts(next))
                      tune(frequency, mode, zoom, filterWidth, viewCenter, next);
                  }}
                />
              </label>
              <small>
                {cuts.lowCut}…{cuts.highCut} Hz
              </small>
            </div>
            <small>
              {mode === "FM"
                ? "Узкополосная FM в диапазоне HF"
                : "Демодуляция выполняется на KiwiSDR"}
            </small>
          </div>
        </section>
        <section
          className={"visual panel malachite" + (connected ? " receiving" : "")}
          data-start={view.start}
          data-span={view.span}
          data-zoom={view.zoom ?? zoom}
        >
          <div className="visual-head">
            <div>
              <span className={"dot " + (connected ? "live" : "")} /> PANORAMA{" "}
              <span className="subtle">
                / VFO A · {frequency.toFixed(3)} kHz · {mode}
              </span>
            </div>
            <div className="zoom">
              <button
                aria-label="Сбросить масштаб: обзор диапазона"
                onClick={() => changeView(frequency, Math.min(6, maxZoom))}
              >
                Обзор
              </button>
              <button
                aria-label="Уменьшить масштаб"
                onClick={() => changeZoom(Math.max(0, zoom - 1))}
              >
                −
              </button>
              <span>
                ZOOM {view.zoom ?? zoom} · ×{2 ** (view.zoom ?? zoom)}
              </span>
              <button
                aria-label="Увеличить масштаб"
                onClick={() => changeZoom(Math.min(maxZoom, zoom + 1))}
              >
                +
              </button>
            </div>
          </div>
          <div className="view-readout" aria-live="off">
            <output>
              {frequencyLabel(view.start, view.span)} —{" "}
              {frequencyLabel(view.start + view.span, view.span)}
            </output>
            <span>
              {viewPending ? "Ожидаем диапазон Kiwi…" : "Диапазон Kiwi"} ·
              полоса {view.span.toFixed(3)} kHz
            </span>
          </div>
          <div className="gesture-toolbar">
            <button
              onClick={() => {
                changeView(frequency);
                manager.current?.flushTune();
              }}
            >
              К частоте
            </button>
            <button
              aria-label="Панорама влево"
              onClick={() => changeView(viewCenter - view.span * 0.3)}
            >
              ←
            </button>
            <button
              aria-label="Панорама вправо"
              onClick={() => changeView(viewCenter + view.span * 0.3)}
            >
              →
            </button>
          </div>
          <div className="scope">
            <canvas
              ref={spectrum}
              width={1024}
              height={240}
              {...spectrumGesture}
              tabIndex={0}
              aria-label="Спектр: касание и перетаскивание для настройки"
            />
            <div className="power-axis" aria-hidden="true">
              <span>−25</span>
              <span>−55</span>
              <span>−85</span>
              <span>−115 dBm</span>
            </div>
            <div className="scope-vfo" aria-live="off">
              <b>VFO A</b> {frequencyLabel(frequency, view.span)}{" "}
              <small>
                {mode} · {cuts.highCut - cuts.lowCut} Hz
              </small>
            </div>
            {filterBand && (
              <div
                className="passband"
                style={{
                  left: `${filterBand.left}%`,
                  width: `${filterBand.width}%`,
                }}
                aria-hidden="true"
              />
            )}
            {frequency >= view.start && frequency <= view.start + view.span && (
              <div
                className="marker"
                style={{ left: `${marker}%` }}
                aria-hidden="true"
              />
            )}
          </div>
          <div
            ref={scale}
            className="axis frequency-scale"
            role="slider"
            tabIndex={0}
            aria-label="Шкала частоты: перетащите для настройки"
            aria-valuemin={0}
            aria-valuemax={30000000}
            aria-valuenow={Math.round(frequency * 1000)}
            {...scaleGesture}
          >
            {Array.from({ length: 5 }, (_, i) => (
              <span
                key={i}
                className={i === 2 ? "center-frequency" : undefined}
              >
                {i === 2 && <small>ЦЕНТР</small>}
                {frequencyLabel(view.start + (view.span * i) / 4, view.span)}
              </span>
            ))}
          </div>
          <div className="fall">
            {filterBand && (
              <div
                className="passband waterfall-passband"
                style={{
                  left: `${filterBand.left}%`,
                  width: `${filterBand.width}%`,
                }}
                aria-hidden="true"
              />
            )}
            {frequency >= view.start && frequency <= view.start + view.span && (
              <div
                className="marker waterfall-marker"
                style={{ left: `${marker}%` }}
                aria-hidden="true"
              />
            )}
            <canvas
              ref={waterfall}
              width={1024}
              height={480}
              {...waterfallGesture}
              tabIndex={0}
              aria-label="Waterfall: вертикальный свайп — прокрутка страницы; касание — частота; два пальца — масштаб"
              title="Прокрутка — страница; Ctrl + колесо или два пальца — масштаб"
            />
            {!waterfallReady && (
              <div className="empty">
                <span>≋</span>
                <strong>
                  {wanted
                    ? "Ожидаем данные приёмника"
                    : "Эфир начинается здесь"}
                </strong>
                <small>Включите приёмник, чтобы увидеть спектр</small>
              </div>
            )}
          </div>
          <div className="visual-foot">
            <span>Касание — частота · два пальца — масштаб</span>
            <span>
              Шум · авто <i /> Сильный сигнал
            </span>
          </div>
        </section>
        <div
          className="precision-controls panel"
          role="group"
          aria-label="Точная настройка"
        >
          <FineTune
            frequencyHz={frequencyHz}
            stepHz={Math.round(step * 1000)}
            onTune={(hz) => tune(hz / 1000)}
            onEnd={() => manager.current?.flushTune()}
            viewCenterHz={Math.round((view.start + view.span / 2) * 1000)}
            zoom={zoom}
            maxZoom={maxZoom}
            onRecenter={() => changeView(frequency, zoom)}
            onZoom={changeZoom}
          />
        </div>
        <BandSelector
          tune={(f, m) => tune(f, m, Math.min(6, maxZoom), widths[m], f)}
        />
        <section className="bottom quick-only">
          <QuickTune
            frequency={frequency}
            mode={mode}
            width={filterWidth}
            connected={connected}
            onTune={(f, m, width) => tune(f, m, zoom, width ?? widths[m])}
          />
        </section>
        <section id="favorites" className="favorites-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ВАША КОЛЛЕКЦИЯ</span>
              <h2>Избранное</h2>
            </div>
            <p>Серверы и частоты сохраняются на этом устройстве.</p>
          </div>
          <div className="favorite-servers panel">
            <label>ИЗБРАННЫЕ СЕРВЕРЫ</label>
            <div>
              {receivers
                .filter((r) => favoriteServers.includes(r.id))
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      chooseReceiver(r.id);
                      document
                        .getElementById("listen")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    {r.name}
                  </button>
                ))}
            </div>
            {!favoriteServers.length && (
              <p>Нажмите ☆ рядом с приёмником, чтобы сохранить сервер.</p>
            )}
          </div>
          <section className="saved-frequencies panel">
            <label>ИЗБРАННЫЕ ЧАСТОТЫ</label>
            {!favoriteFrequencies.length && (
              <p>Настройтесь на станцию и нажмите «☆ Сохранить».</p>
            )}
            <div>
              {favoriteFrequencies.map((v) => (
                <span key={v.id}>
                  <button
                    onClick={() =>
                      tune(
                        v.frequency,
                        v.mode,
                        zoom,
                        v.width ?? widths[v.mode],
                        undefined,
                        v.cuts,
                      )
                    }
                  >
                    {v.frequency} kHz · {v.mode}
                  </button>
                  <button
                    aria-label={`Удалить частоту ${v.frequency}`}
                    onClick={() =>
                      setFavoriteFrequencies((list) =>
                        list.filter((x) => x.id !== v.id),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </section>
        </section>
        <section id="about" className="about-section panel">
          <QslCard full />
          <div>
            <span className="eyebrow">О ПРОЕКТЕ</span>
            <h2>UR4MTN WEB SDR</h2>
            <p>
              UR4MTN — радиолюбительский WebSDR-проект Максима Попкова из города
              Попасная. Максим — радиолюбитель и веб-разработчик радио-систем.
            </p>
            <p>
              Проект объединяет публичные KiwiSDR, реальный звук, spectrum и
              waterfall. Слушайте эфир с телефона, планшета и компьютера.
            </p>
            <p>
              Установите приложение через меню браузера, чтобы открыть эфир с
              главного экрана. Для приёма нужен интернет; звук включается
              кнопкой «Слушать эфир».
            </p>
          </div>
        </section>
        <footer>
          <span>UR4MTN WEB SDR / KiwiSDR</span>
          <span hidden={!new URLSearchParams(location.search).has("debug")}>
            {audioDebug &&
              `Очередь ${audioDebug.queueMs.toFixed(0)} мс · цель ${audioDebug.targetMs.toFixed(0)} мс · underrun ${audioDebug.underflowFrames} · `}
            {counts.audio} PCM · {counts.wf} WF · {Math.round(rate.current)} Hz
          </span>
        </footer>
      </main>
      <RadioMapLauncher />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(console.error);
