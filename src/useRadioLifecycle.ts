import { useEffect, useRef, useState, type RefObject } from "react";
import { useStoredState } from "./storage";
import type { StreamConnection } from "./connection";
import "./backgroundAudio.css";
import { audioDiagnostic, audioSnapshot } from "./audioDiagnostics";
type Options = {
  audio: RefObject<HTMLAudioElement | null>;
  nativeAudio: RefObject<HTMLAudioElement | null>;
  native: boolean;
  context: RefObject<AudioContext | null>;
  manager: RefObject<StreamConnection | null>;
  wanted: boolean;
  live: boolean;
  frequency: number;
  mode: string;
  receiverName: string;
  start: () => Promise<void>;
  recover: () => Promise<void>;
  stop: () => void;
  onVisible: (visible: boolean) => void;
  setAudioPaused: (paused: boolean) => void;
};
export function useRadioLifecycle(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [background, setBackground] = useStoredState(
    "wave.background",
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  const [wakeEnabled, setWakeEnabled] = useStoredState(
    "wave.wakeLock",
    false,
    (v): v is boolean => typeof v === "boolean",
  );
  const [wakeHeld, setWakeHeld] = useState(false),
    [wakeError, setWakeError] = useState(""),
    [frozen, setFrozen] = useState(false);
  const [mediaPaused, setMediaPaused] = useState(false);
  const [outputPlaying, setOutputPlaying] = useState(false);
  const recovering = useRef<Promise<void> | null>(null);
  const policy = useRef(background);
  policy.current = background;
  function recordDiagnostic(event: string) {
    const v = latest.current;
    audioDiagnostic(event, {
      hidden: document.hidden,
      background: policy.current,
      output: v.native && policy.current ? "http-mp3" : "pcm-worklet",
      wanted: v.manager.current?.desired,
      context: v.context.current?.state,
      frequency: v.frequency,
      mode: v.mode,
      receiver: v.receiverName,
      native: audioSnapshot(v.nativeAudio.current),
      pcm: audioSnapshot(v.audio.current),
    });
  }
  async function recover() {
    if (
      !latest.current.manager.current?.desired ||
      (document.hidden && !policy.current)
    )
      return;
    if (recovering.current) return recovering.current;
    latest.current.manager.current.recoverAfterSleep();
    const task = latest.current
      .recover()
      .catch(() => latest.current.setAudioPaused(true))
      .finally(() => {
        recovering.current = null;
      });
    recovering.current = task;
    return task;
  }
  useEffect(() => {
    const audio = latest.current.audio.current!;
    const synchronize = (event?: Event) => {
      const v = latest.current;
      const output =
        v.native && policy.current ? v.nativeAudio.current! : audio;
      if (event?.currentTarget === output)
        recordDiagnostic("audio:" + event.type);
      const paused =
        output.paused ||
        output.ended ||
        output.error !== null ||
        (v.native && policy.current && output.readyState < 3) ||
        (!(v.native && policy.current) &&
          v.context.current?.state !== "running");
      v.setAudioPaused(paused);
      setOutputPlaying(!paused);
    };
    const interrupted = (event: Event) => {
      const v = latest.current;
      const output = v.native && policy.current ? v.nativeAudio.current : audio;
      if (event.currentTarget !== output) return;
      recordDiagnostic("audio:" + event.type);
      synchronize();
      if (latest.current.manager.current?.desired) void recover();
    };
    const visible = () => {
      recordDiagnostic("page:visibility");
      const shown = !document.hidden;
      latest.current.manager.current?.setBackground(!shown);
      latest.current.onVisible(shown);
      if (shown) {
        setFrozen(false);
        void recover();
      } else if (!policy.current) {
        audio.pause();
        latest.current.nativeAudio.current?.pause();
        void latest.current.context.current?.suspend();
      }
    };
    const freeze = () => {
      recordDiagnostic("page:freeze-or-hide");
      setFrozen(true);
      latest.current.manager.current?.setBackground(true);
      latest.current.onVisible(false);
    };
    const resume = () => {
      recordDiagnostic("page:resume-or-show");
      setFrozen(false);
      visible();
    };
    const offline = () => {
      recordDiagnostic("page:offline");
      latest.current.setAudioPaused(true);
    };
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("freeze", freeze);
    document.addEventListener("resume", resume);
    window.addEventListener("pagehide", freeze);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    const outputs = [audio, latest.current.nativeAudio.current!];
    for (const output of outputs) {
      for (const event of ["pause", "stalled", "waiting", "ended", "error"])
        output.addEventListener(event, interrupted);
      output.addEventListener("playing", synchronize);
    }
    visible();
    return () => {
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("freeze", freeze);
      document.removeEventListener("resume", resume);
      window.removeEventListener("pagehide", freeze);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      for (const output of outputs) {
        for (const event of ["pause", "stalled", "waiting", "ended", "error"])
          output.removeEventListener(event, interrupted);
        output.removeEventListener("playing", synchronize);
      }
    };
  }, []);
  useEffect(() => {
    if (!background && document.hidden) {
      latest.current.audio.current?.pause();
      latest.current.nativeAudio.current?.pause();
      void latest.current.context.current?.suspend();
    } else if (background) void recover();
  }, [background]);
  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    const handlers: { [key: string]: () => void } = {
      play: () => {
        recordDiagnostic("media-session:play");
        setMediaPaused(false);
        void latest.current.start();
      },
      pause: () => {
        recordDiagnostic("media-session:pause");
        latest.current.stop();
        setMediaPaused(true);
      },
      stop: () => {
        recordDiagnostic("media-session:stop");
        latest.current.stop();
        setMediaPaused(false);
      },
    };
    for (const [action, handler] of Object.entries(handlers))
      try {
        session.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        /* Optional action support differs by browser. */
      }
    return () => {
      for (const action of Object.keys(handlers))
        try {
          session.setActionHandler(action as MediaSessionAction, null);
        } catch {}
    };
  }, []);
  useEffect(() => {
    if (!navigator.mediaSession) return;
    if (typeof MediaMetadata !== "undefined")
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `${(options.frequency / 1000).toFixed(6)} MHz · ${options.mode}`,
        artist: "UR4MTN WEB SDR",
        album: options.receiverName,
        artwork: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      });
    const playing =
      options.native && background
        ? options.wanted && outputPlaying
        : options.live && !frozen;
    navigator.mediaSession.playbackState = playing
      ? "playing"
      : options.wanted || mediaPaused
        ? "paused"
        : "none";
  }, [
    options.frequency,
    options.mode,
    options.receiverName,
    options.wanted,
    options.live,
    frozen,
    mediaPaused,
    options.native,
    outputPlaying,
    background,
  ]);
  useEffect(() => {
    let disposed = false,
      sentinel: WakeLockSentinel | null = null,
      acquiring = false;
    async function request() {
      if (
        disposed ||
        acquiring ||
        sentinel ||
        !wakeEnabled ||
        !latest.current.manager.current?.desired ||
        document.hidden ||
        !navigator.wakeLock
      )
        return;
      acquiring = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (
          disposed ||
          document.hidden ||
          !latest.current.manager.current?.desired
        ) {
          await lock.release();
          return;
        }
        sentinel = lock;
        setWakeHeld(true);
        setWakeError("");
        lock.addEventListener("release", () => {
          sentinel = null;
          if (!disposed) setWakeHeld(false);
        });
      } catch {
        if (!disposed) setWakeError("Браузер не разрешил удерживать экран.");
      } finally {
        acquiring = false;
      }
    }
    const visible = () => {
      if (document.hidden) {
        void sentinel?.release();
        setWakeHeld(false);
      } else void request();
    };
    document.addEventListener("visibilitychange", visible);
    void request();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visible);
      void sentinel?.release();
      setWakeHeld(false);
    };
  }, [wakeEnabled, options.wanted]);
  return {
    background,
    nativeEnabled: options.native && background,
    setBackground,
    wakeEnabled,
    setWakeEnabled,
    wakeHeld,
    wakeError,
    frozen,
    mediaPaused,
    recover,
    recordDiagnostic,
    wakeSupported: !!navigator.wakeLock,
  };
}
