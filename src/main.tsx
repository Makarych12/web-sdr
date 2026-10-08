import React, { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./brand.css";
import "./console.css";
import { Antenna, Landing, BandSelector, QslCard } from "./Landing";
import { gateway, gatewayConfigured } from "./gateway";
import { VfoDial } from "./VfoDial";
import { FineTune } from "./FineTune";
import { QuickTune } from "./QuickTune";
import { useRadioLifecycle } from "./useRadioLifecycle";
import {
  readRadioSession,
  saveRadioSession,
  playbackSession,
} from "./radioSession";
import { ReceiverPicker, type Receiver } from "./ReceiverPicker";
import { useStoredState, stringList, finiteNumber } from "./storage";
import {
  StreamConnection,
  type ConnectionState,
  type KiwiEvent,
} from "./connection";
import { useSpectrumGesture } from "./useSpectrumGesture";
import { SpectrumRenderer } from "./spectrumRenderer";
import {
  viewFor,
  sameView,
  matchesRequest,
  frequencyLabel,
  filterPosition,
} from "./spectrumView";
import { DirectKiwiSocket } from "./directKiwi";
import {
  nativeAudioURL,
  needsNativeBackground,
  nativeStreamUnavailable,
} from "./nativeAudio";
import {
  audioDiagnostic,
  audioDiagnosticReport,
  audioSnapshot,
} from "./audioDiagnostics";
import { SMeter } from "./SMeter";
import { type Mode, DEFAULT_WIDTHS, FILTER_WIDTHS, passband } from "./radio";
type SavedFrequency = {
  id: string;
  frequency: number;
  mode: Mode;
  width?: number;
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
  const [restored] = useState(readRadioSession);
  const [nativeUnavailable, setNativeUnavailable] = useState(false);
  const [audioReport, setAudioReport] = useState("");
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [restoreNeeded, setRestoreNeeded] = useState(
    restored?.playing ?? false,
  );
  const [agc, setAgc] = useStoredState<"fast" | "slow" | "off">(
    "wave.agc",
    "slow",
    (v): v is "fast" | "slow" | "off" =>
      ["fast", "slow", "off"].includes(String(v)),
  );
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
    [frequency, setFrequency] = useState(restored?.frequency ?? 10000),
    [draft, setDraft] = useState(String(restored?.frequency ?? 10000)),
    [mode, setMode] = useState<Mode>(restored?.mode ?? "AM"),
    [zoom, setZoom] = useState(restored?.zoom ?? 6),
    [viewCenter, setViewCenter] = useState(restored?.viewCenter ?? 10000),
    [maxZoom, setMaxZoom] = useState(14),
    [gestureMode, setGestureMode] = useState<"tune" | "pan">("tune"),
    [step, setStep] = useStoredState(
      "wave.step",
      1,
      (v): v is number =>
        finiteNumber(v) && [0.001, 0.01, 0.1, 1, 5, 10].includes(v),
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
      viewFor(restored?.viewCenter ?? 10000, restored?.zoom ?? 6, 30000),
    ),
    [offline, setOffline] = useState(!navigator.onLine);
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
        : [...list, { id, frequency, mode, width: filterWidth }],
    );
  }
  const manager = useRef<StreamConnection | null>(null);
  const receiverRef = useRef(receiver);
  receiverRef.current = receiver;
  const availableReceivers = useRef(receivers);
  availableReceivers.current = receivers;
  const failedReceivers = useRef(new Set<string>());
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
    player = useRef<AudioWorkletNode | null>(null),
    audioElement = useRef<HTMLAudioElement | null>(null),
    nativeAudioElement = useRef<HTMLAudioElement | null>(null),
    nativeOutput = useRef(false),
    nativeSession = useRef(crypto.randomUUID()),
    nativeTuneKey = useRef(""),
    nativeSequence = useRef(0),
    nativeTuneRequest = useRef<AbortController | null>(null),
    mediaDestination = useRef<MediaStreamAudioDestinationNode | null>(null),
    pendingAudio = useRef<Promise<void> | null>(null),
    startGeneration = useRef(0),
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
      ...passband(mode, filterWidth),
    }),
    stats = useRef({ audio: 0, wf: 0 }),
    initializing = useRef(false),
    rate = useRef(12000),
    viewRef = useRef(view),
    calibration = useRef(-13);
  settings.current = {
    frequency,
    mode,
    zoom,
    viewCenter,
    agc,
    ...passband(mode, filterWidth),
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
        if (rows.length && !rows.some((r) => r.id === receiverRef.current)) {
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
      manager.current?.stop();
      clearNativeAudio();
      audioElement.current?.pause();
      mediaDestination.current?.stream
        .getTracks()
        .forEach((track) => track.stop());
      void context.current?.close();
    };
  }, []);
  useEffect(() => {
    if (gain.current)
      gain.current.gain.setTargetAtTime(
        muted ? 0 : volume,
        context.current!.currentTime,
        0.025,
      );
    if (nativeAudioElement.current) {
      nativeAudioElement.current.volume = volume;
      nativeAudioElement.current.muted = muted;
    }
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
  ) {
    f = Math.round(Math.max(0, Math.min(30000, f)) * 1000) / 1000;
    // Fine tuning moves the VFO inside the existing overview. Recenter only
    // when it leaves the usable area, or when an explicit view was requested.
    const currentView = viewRef.current;
    center ??=
      f >= currentView.start + currentView.span * 0.1 &&
      f <= currentView.start + currentView.span * 0.9
        ? settings.current.viewCenter
        : f;
    const nextView = viewFor(center, z, viewRef.current.bandwidth ?? 30000);
    const viewChanged = !matchesRequest(currentView, nextView);
    if (viewChanged || m !== settings.current.mode) {
      renderer.current?.clear(false);
    }
    if (viewChanged) awaitingTune.current = wanted;
    center = nextView.start + nextView.span / 2;
    if (viewChanged) {
      requestedView.current = nextView;
      setViewPending(wanted);
      displayView(nextView);
    }
    setViewCenter(center);
    setFrequency(f);
    setDraft(String(Number(f.toFixed(3))));
    setMode(m);
    setZoom(z);
    setWidths((prev) => (prev[m] === width ? prev : { ...prev, [m]: width }));
    settings.current = {
      frequency: f,
      mode: m,
      zoom: z,
      viewCenter: center,
      agc,
      ...passband(m, width),
    };
    manager.current?.tune();
  }

  function displayView(next: View) {
    if (sameView(viewRef.current, next)) return;
    viewRef.current = next;
    renderer.current?.setView(next);
    setView(next);
  }
  callbacks.current.state = (v) => {
    audioDiagnostic("connection:" + v.phase, {
      desired: manager.current?.desired,
      hidden: document.hidden,
      native: audioSnapshot(nativeAudioElement.current),
    });
    setWanted(manager.current?.desired ?? false);
    if (v.phase === "idle" || v.phase === "blocked") {
      clearNativeAudio();
      audioElement.current?.pause();
      if (context.current?.state === "running") void context.current.suspend();
    }
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
        if (nativeOutput.current) {
          stats.current.audio++;
          return;
        }
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
        return receiver?.directUrl
          ? (new DirectKiwiSocket(receiver.directUrl) as unknown as WebSocket)
          : new WebSocket(url);
      },
      onDiagnostic: (event) => {
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
  function clearNativeAudio() {
    const native = nativeAudioElement.current;
    if (!native) return;
    if (native.getAttribute("src"))
      audioDiagnostic("native:clear", {
        hidden: document.hidden,
        desired: manager.current?.desired,
      });
    nativeTuneRequest.current?.abort();
    nativeTuneKey.current = "";
    native.pause();
    native.removeAttribute("src");
    native.load();
  }
  async function nativePlayOrFallback() {
    const native = nativeAudioElement.current!;
    const source = native.src;
    try {
      await native.play();
    } catch (error) {
      // An old play promise can reject after a newer stream or explicit stop.
      if (native.src !== source || !native.getAttribute("src")) return;
      audioDiagnostic("native:play-error", {
        name: error instanceof Error ? error.name : String(error),
        hidden: document.hidden,
        native: audioSnapshot(native),
      });
      if (!nativeStreamUnavailable(error, native.error?.code ?? null))
        throw error;
      audioDiagnostic("native:fallback-pcm");
      setNativeUnavailable(true);
      nativeOutput.current = false;
      clearNativeAudio();
      audioElement.current!.muted = false;
      await preparePCM();
    }
  }
  async function playNativeAudio() {
    // Only one output owns playback. Do not keep a silent MediaStream player
    // active beside the HTTP player (especially in Android WebView).
    audioElement.current!.pause();
    audioElement.current!.srcObject = null;
    if (context.current?.state === "running") void context.current.suspend();
    const native = nativeAudioElement.current!;
    const config = { receiver: receiverRef.current, ...settings.current };
    const url = nativeAudioURL(gateway.http, config, nativeSession.current);
    native.volume = volume;
    native.muted = muted;
    function restart() {
      audioDiagnostic("native:restart", {
        frequency: config.frequency,
        mode: config.mode,
        hidden: document.hidden,
      });
      nativeTuneRequest.current?.abort();
      // Never let a new stream's commands reach an old serverless instance.
      nativeSession.current = crypto.randomUUID();
      nativeSequence.current = 0;
      const freshURL = nativeAudioURL(
        gateway.http,
        config,
        nativeSession.current,
      );
      nativeTuneKey.current = freshURL;
      native.dataset.frequency = String(config.frequency);
      native.dataset.mode = config.mode;
      native.dataset.agc = config.agc;
      native.dataset.highCut = String(config.highCut);
      native.src = freshURL;
      return nativePlayOrFallback();
    }
    if (
      !native.getAttribute("src") ||
      native.ended ||
      native.error ||
      new URL(native.src).searchParams.get("receiver") !== receiverRef.current
    )
      return restart();
    if (nativeTuneKey.current !== url) {
      nativeTuneRequest.current?.abort();
      const request = new AbortController();
      nativeTuneRequest.current = request;
      const control = new URL(url);
      control.pathname = "/api/audio/tune";
      control.searchParams.set("sequence", String(++nativeSequence.current));
      try {
        const response = await fetch(control, {
          cache: "no-store",
          signal: request.signal,
        });
        if (request.signal.aborted) return;
        if (!response.ok) {
          // A restarted/different serverless instance has lost this live session.
          // Reconnect with current settings rather than playing a stale frequency.
          return restart();
        }
        nativeTuneKey.current = url;
        native.dataset.frequency = String(config.frequency);
        native.dataset.mode = config.mode;
        native.dataset.agc = config.agc;
        native.dataset.highCut = String(config.highCut);
      } catch (error) {
        if (request.signal.aborted) return;
        throw error;
      }
    }
    return nativePlayOrFallback();
  }
  async function preparePCM() {
    const audio = audioElement.current!;
    let fresh = false;
    if (!context.current || context.current.state === "closed") {
      mediaDestination.current?.stream
        .getTracks()
        .forEach((track) => track.stop());
      context.current = new AudioContext({ latencyHint: "playback" });
      player.current = null;
      mediaDestination.current = context.current.createMediaStreamDestination();
      fresh = true;
      context.current.onstatechange = () => {
        audioDiagnostic("context:state", {
          state: context.current?.state,
          native: nativeOutput.current,
          hidden: document.hidden,
        });
        if (nativeOutput.current) return;
        const paused = context.current?.state !== "running" || audio.paused;
        setAudioPaused(paused);
        if (paused && manager.current?.desired) void lifecycle.recover();
      };
    }
    if (audio.srcObject !== mediaDestination.current!.stream)
      audio.srcObject = mediaDestination.current!.stream;
    // Invoke playback while the user gesture still grants permission.
    const playing = Promise.all([context.current.resume(), audio.play()]);
    void playing.catch(() => {});
    if (fresh || !player.current) {
      await context.current.audioWorklet.addModule("/audio-worklet.js");
      player.current = new AudioWorkletNode(context.current, "pcm-player");
      gain.current = context.current.createGain();
      gain.current.gain.value = muted ? 0 : volume;
      player.current.connect(gain.current).connect(mediaDestination.current!);
    }
    await playing;
  }
  async function prepareAudio() {
    if (pendingAudio.current) return pendingAudio.current;
    const task = (async () => {
      playbackSession();
      // HTTP playback must not create or run an AudioContext/MediaStream sink.
      const playing = nativeOutput.current ? playNativeAudio() : preparePCM();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          playing,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error("Браузер ожидает нажатия для включения звука"),
                ),
              nativeOutput.current ? 20000 : 4000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      setAudioPaused(
        nativeOutput.current
          ? nativeAudioElement.current!.paused ||
              nativeAudioElement.current!.ended ||
              nativeAudioElement.current!.error !== null ||
              nativeAudioElement.current!.readyState < 3
          : context.current?.state !== "running" ||
              audioElement.current!.paused,
      );
    })();
    pendingAudio.current = task;
    try {
      await task;
    } finally {
      pendingAudio.current = null;
    }
  }
  function stopRadio() {
    ++startGeneration.current;
    setRestoreNeeded(false);
    manager.current?.stop();
    clearNativeAudio();
    audioElement.current?.pause();
    void context.current?.suspend();
  }
  async function startRadio() {
    if (initializing.current || !gatewayConfigured) return;
    if (manager.current?.desired) {
      manager.current.recoverAfterSleep();
      try {
        await prepareAudio();
      } catch {
        setAudioPaused(true);
      }
      return;
    }
    initializing.current = true;
    const generation = ++startGeneration.current;
    setPreparing(true);
    setError("");
    try {
      await prepareAudio();
      if (generation !== startGeneration.current) {
        audioElement.current?.pause();
        void context.current?.suspend();
        return;
      }
      setRestoreNeeded(false);
      stats.current = { audio: 0, wf: 0 };
      setCounts({ ...stats.current });
      renderer.current?.clear();
      failedReceivers.current.clear();
      manager.current!.start();
    } catch (e) {
      if (generation !== startGeneration.current) return;
      setAudioPaused(true);
      setRestoreNeeded(true);
      setStatus("Нажмите «Возобновить звук»");
      if (!player.current) {
        await context.current?.close();
        context.current = null;
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      initializing.current = false;
      setPreparing(false);
    }
  }
  async function connect() {
    if (manager.current?.desired) stopRadio();
    else await startRadio();
  }
  useEffect(() => {
    if (!restored) return;
    receiverRef.current = restored.receiver;
    setReceiver(restored.receiver);
    setAgc(restored.agc);
    setWidths((prev) => ({ ...prev, [restored.mode]: restored.width }));
  }, []);
  useEffect(() => {
    saveRadioSession({
      frequency,
      mode,
      width: filterWidth,
      zoom,
      viewCenter,
      agc,
      receiver,
      playing: wanted || restoreNeeded,
    });
  }, [
    frequency,
    mode,
    filterWidth,
    zoom,
    viewCenter,
    agc,
    receiver,
    wanted,
    restoreNeeded,
  ]);
  const restoreAttempted = useRef(false);
  useEffect(() => {
    if (
      !restoreAttempted.current &&
      restored?.playing &&
      receivers.length &&
      !offline
    ) {
      restoreAttempted.current = true;
      void startRadio();
    }
  }, [receivers.length, offline]);
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
      renderer.current?.clear(false);
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
    mode: gestureMode,
    step,
    frequency,
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
    mode: "tune",
  });
  const waterfallGesture = useSpectrumGesture({
    canvas: waterfall,
    ...gestureOptions,
  });
  const marker = Math.max(
    0,
    Math.min(100, ((frequency - view.start) / view.span) * 100),
  );
  const filterBand = filterPosition(
    view,
    frequency,
    passband(mode, filterWidth).lowCut,
    passband(mode, filterWidth).highCut,
  );
  const lifecycle = useRadioLifecycle({
    audio: audioElement,
    nativeAudio: nativeAudioElement,
    native: needsNativeBackground && !nativeUnavailable,
    context,
    manager,
    wanted,
    live:
      connected && !audioPaused && !offline && !!manager.current?.hasFreshAudio,
    frequency,
    mode,
    receiverName: receivers.find((r) => r.id === receiver)?.name ?? receiver,
    start: startRadio,
    recover: prepareAudio,
    stop: stopRadio,
    setAudioPaused,
    onVisible: (visible) => renderer.current?.setVisible(visible),
  });
  nativeOutput.current = lifecycle.nativeEnabled;
  useEffect(() => {
    audioElement.current!.muted = lifecycle.nativeEnabled;
    if (!wanted) return;
    if (!lifecycle.nativeEnabled) {
      clearNativeAudio();
      void prepareAudio().catch(() => setAudioPaused(true));
      return;
    }
    // Coalesce rapid VFO changes; view zoom/pan don't affect this URL.
    const timer = setTimeout(() => {
      void playNativeAudio().catch(() => setAudioPaused(true));
    }, 180);
    return () => clearTimeout(timer);
  }, [
    wanted,
    lifecycle.nativeEnabled,
    frequency,
    mode,
    filterWidth,
    agc,
    receiver,
  ]);
  const live =
    connected &&
    !audioPaused &&
    (!lifecycle.frozen || lifecycle.nativeEnabled) &&
    !offline &&
    !!manager.current?.hasFreshAudio;
  return (
    <div className={"app" + (wanted ? " playing" : "")}>
      <audio
        ref={audioElement}
        className="radio-audio-output"
        muted={lifecycle.nativeEnabled}
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <audio
        ref={nativeAudioElement}
        className="radio-audio-output native-radio-output"
        playsInline
        preload="none"
        aria-hidden="true"
      />
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
          <span className={"dot " + (live ? "live" : "")} />
          {offline
            ? "Нет сети"
            : retryAt
              ? "Переподключение…"
              : error && !wanted
                ? "Ошибка"
                : live
                  ? "ONLINE · В эфире"
                  : wanted && (audioPaused || lifecycle.frozen)
                    ? "Звук приостановлен"
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
              preparing
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
            {live
              ? "Играет"
              : wanted && audioPaused
                ? "Звук приостановлен"
                : wanted
                  ? "Подключение"
                  : "Выбран"}{" "}
            ·{" "}
            {lifecycle.nativeEnabled
              ? "Фоновый аудиопоток"
              : receivers.find((r) => r.id === receiver)?.directUrl
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
        {(wanted || restoreNeeded) && audioPaused && (
          <div className="reconnect-banner">
            <span>Браузер приостановил звук</span>
            <button onClick={() => void startRadio()}>Возобновить звук</button>
          </div>
        )}
        <section className="background-audio panel" aria-label="Фоновый эфир">
          <div className="background-audio-controls">
            <label>
              <input
                type="checkbox"
                checked={lifecycle.background}
                onChange={(e) => {
                  setNativeUnavailable(false);
                  lifecycle.setBackground(e.target.checked);
                }}
              />
              Фоновый эфир
            </label>
            <label>
              <input
                type="checkbox"
                checked={lifecycle.wakeEnabled}
                disabled={!lifecycle.wakeSupported}
                onChange={(e) => lifecycle.setWakeEnabled(e.target.checked)}
              />
              Оставлять экран включённым
            </label>
          </div>
          <strong role="status">
            {live
              ? nativeUnavailable
                ? "Эфир играет · фоновый поток недоступен"
                : lifecycle.background
                  ? "Фоновый звук активен"
                  : "Эфир играет · фоновый режим выключен"
              : lifecycle.frozen
                ? "Система приостановила страницу. Восстанавливаем эфир…"
                : (wanted || restoreNeeded) && audioPaused
                  ? "Браузер приостановил звук — нажмите «Возобновить звук»"
                  : wanted
                    ? "Ожидаем аудиопоток"
                    : "Запустите эфир"}
          </strong>
          <p>
            При выключенном экране waterfall может не обновляться. Фоновый звук
            работает, пока браузер разрешает воспроизведение. Если система
            выгрузит страницу, эфир восстановится после возвращения; браузер
            может запросить нажатие для включения звука.
          </p>
          {nativeUnavailable && (
            <p>
              Не удалось запустить фоновый аудиопоток. Обычный эфир сохранён;
              для повтора выключите и включите «Фоновый эфир». Приёмнику нужен
              свободный канал.
            </p>
          )}
          {lifecycle.nativeEnabled && (
            <p>
              На телефоне используется прямой аудиопоток для фонового
              воспроизведения. Если браузер отключает эфир во сне, разрешите ему
              работу без ограничений в настройках батареи телефона.
            </p>
          )}
          {lifecycle.wakeHeld && (
            <p>Экран остаётся включённым во время просмотра.</p>
          )}
          {lifecycle.wakeError && lifecycle.wakeEnabled && (
            <p>{lifecycle.wakeError}</p>
          )}
          <details className="audio-diagnostics">
            <summary>Диагностика фонового звука</summary>
            <p>
              После блокировки и разблокировки экрана скопируйте журнал. Он
              покажет выбранный аудиовывод и события остановки. Журнал хранится
              только в этой вкладке.
            </p>
            <a
              href={
                "/audio-check.html" +
                new URL(
                  nativeAudioURL(gateway.http, {
                    receiver,
                    ...settings.current,
                  }),
                ).search
              }
              onClick={stopRadio}
            >
              Проверить звук отдельно от SDR
            </a>
            <button
              onClick={async () => {
                lifecycle.recordDiagnostic("user:report");
                const report = audioDiagnosticReport();
                setAudioReport(report);
                try {
                  await navigator.clipboard.writeText(report);
                  setDiagnosticCopied(true);
                } catch {
                  setDiagnosticCopied(false);
                }
              }}
            >
              {diagnosticCopied
                ? "Журнал скопирован"
                : "Скопировать диагностику звука"}
            </button>
            {audioReport && (
              <textarea
                readOnly
                aria-label="Журнал фонового звука"
                value={audioReport}
              />
            )}
          </details>
        </section>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <section className={"tuner panel" + (connected ? " receiving" : "")}>
          <div className="frequency">
            <label htmlFor="frequency">ЧАСТОТА · VFO A</label>
            <output
              className="digital-frequency"
              aria-label="Текущая частота Hz"
            >
              {Math.round(frequency * 1000).toLocaleString("de-DE")}
              <small>Hz</small>
            </output>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = Number(draft);
                if (draft.trim() && Number.isFinite(f) && f >= 0 && f <= 30000)
                  tune(f);
                else setError("Введите частоту от 0 до 30000 кГц");
              }}
            >
              <input
                id="frequency"
                aria-label="Частота кГц"
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(",", "."))}
              />
              <span>kHz</span>
              <button title="Настроить" aria-label="Настроить">
                ↵
              </button>
            </form>
          </div>
          <VfoDial
            frequency={frequency}
            step={step}
            onTune={(f) => tune(f)}
            onEnd={() => manager.current?.flushTune()}
          />
          <div className="steps">
            <label className="step-select">
              Шаг{" "}
              <select
                aria-label="Шаг настройки"
                value={step}
                onChange={(e) => setStep(Number(e.target.value))}
              >
                {[0.001, 0.01, 0.1, 1, 5, 10].map((s) => (
                  <option key={s} value={s}>
                    {`${s * 1000} Hz`}
                  </option>
                ))}
              </select>
            </label>
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
          <div className="mode">
            <label>ДЕМОДУЛЯЦИЯ</label>
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
            <div className="filter-control">
              <label htmlFor="filter-width">Полоса фильтра</label>
              <select
                id="filter-width"
                value={filterWidth}
                onChange={(e) =>
                  tune(frequency, mode, zoom, Number(e.target.value))
                }
              >
                {FILTER_WIDTHS[mode].map((w) => (
                  <option value={w} key={w}>
                    {w >= 1000 ? `${w / 1000} kHz` : `${w} Hz`}
                  </option>
                ))}
              </select>
              <small>
                {passband(mode, filterWidth).lowCut}…
                {passband(mode, filterWidth).highCut} Hz
              </small>
            </div>
            <div className="agc-control">
              <label htmlFor="agc">AGC</label>
              <select
                id="agc"
                value={agc}
                onChange={(e) => {
                  const value = e.target.value as typeof agc;
                  setAgc(value);
                  settings.current = { ...settings.current, agc: value };
                  manager.current?.tune();
                }}
              >
                <option value="slow">Медленная</option>
                <option value="fast">Быстрая</option>
                <option value="off">Выкл. · Gain 50</option>
              </select>
            </div>
            <small>
              {mode === "FM"
                ? "Узкополосная FM в диапазоне HF"
                : "Демодуляция выполняется на KiwiSDR"}
            </small>
          </div>
          <SMeter rssi={rssi} />
        </section>
        <section
          className={"visual panel malachite" + (connected ? " receiving" : "")}
          data-start={view.start}
          data-span={view.span}
          data-zoom={view.zoom ?? zoom}
        >
          <div className="visual-head">
            <div>
              <span className={"dot " + (live ? "live" : "")} /> PANORAMA{" "}
              <span className="subtle">/ LIVE DSP</span>
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
          <div className="view-sliders">
            <label>
              Масштаб{" "}
              <input
                type="range"
                aria-label="Масштаб waterfall"
                min="0"
                max={maxZoom}
                step="1"
                value={zoom}
                onChange={(e) => changeZoom(Number(e.target.value))}
              />
            </label>
            <label>
              Центр · {viewCenter.toFixed(3)} kHz{" "}
              <input
                type="range"
                aria-label="Центр waterfall"
                min={view.span / 2}
                max={(view.bandwidth ?? 30000) - view.span / 2}
                step=".001"
                value={viewCenter}
                onChange={(e) => changeView(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="gesture-toolbar">
            <div role="group" aria-label="Управление спектром">
              <button
                aria-pressed={gestureMode === "tune"}
                onClick={() => setGestureMode("tune")}
              >
                ☝ Настройка
              </button>
              <button
                aria-pressed={gestureMode === "pan"}
                onClick={() => setGestureMode("pan")}
              >
                ↔ Панорама
              </button>
            </div>
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
                {mode} · {filterWidth} Hz
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
              aria-label="Waterfall: касание и перетаскивание для настройки"
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
          <FineTune
            frequency={frequency}
            step={step}
            onTune={(f) => tune(f)}
            onEnd={() => manager.current?.flushTune()}
            viewCenter={view.start + view.span / 2}
            zoom={zoom}
            maxZoom={maxZoom}
            onRecenter={() => changeView(frequency, zoom)}
            onZoom={changeZoom}
          />
          <div className="visual-foot">
            <span>Касание — частота · два пальца — масштаб</span>
            <span>
              Шум · авто <i /> Сильный сигнал
            </span>
          </div>
        </section>
        <BandSelector
          tune={(f, m) => tune(f, m, Math.min(6, maxZoom), widths[m], f)}
        />
        <section className="bottom">
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
          <QuickTune
            frequency={frequency}
            mode={mode}
            width={filterWidth}
            connected={live}
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
                      tune(v.frequency, v.mode, zoom, v.width ?? widths[v.mode])
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
          <span>
            {counts.audio} PCM · {counts.wf} WF · {Math.round(rate.current)} Hz
          </span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(console.error);
