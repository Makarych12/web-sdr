import { useEffect, useRef, useState, type RefObject } from "react";
import { useStoredState } from "./storage";
import type { StreamConnection } from "./connection";
import "./backgroundAudio.css";
type Options = {
  audio: RefObject<HTMLAudioElement | null>;
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
  const recovering = useRef<Promise<void> | null>(null);
  const policy = useRef(background);
  policy.current = background;
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
    const synchronize = () => {
      const v = latest.current;
      const paused =
        audio.paused || audio.ended || v.context.current?.state !== "running";
      v.setAudioPaused(paused);
    };
    const interrupted = () => {
      synchronize();
      if (latest.current.manager.current?.desired) void recover();
    };
    const visible = () => {
      const shown = !document.hidden;
      latest.current.manager.current?.setBackground(!shown);
      latest.current.onVisible(shown);
      if (shown) {
        setFrozen(false);
        void recover();
      } else if (!policy.current) {
        audio.pause();
        void latest.current.context.current?.suspend();
      }
    };
    const freeze = () => {
      setFrozen(true);
      latest.current.manager.current?.setBackground(true);
      latest.current.onVisible(false);
    };
    const resume = () => {
      setFrozen(false);
      visible();
    };
    const offline = () => {
      latest.current.setAudioPaused(true);
    };
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("freeze", freeze);
    document.addEventListener("resume", resume);
    window.addEventListener("pagehide", freeze);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    for (const event of ["pause", "stalled", "waiting", "ended", "error"])
      audio.addEventListener(event, interrupted);
    audio.addEventListener("playing", synchronize);
    visible();
    return () => {
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("freeze", freeze);
      document.removeEventListener("resume", resume);
      window.removeEventListener("pagehide", freeze);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      for (const event of ["pause", "stalled", "waiting", "ended", "error"])
        audio.removeEventListener(event, interrupted);
      audio.removeEventListener("playing", synchronize);
    };
  }, []);
  useEffect(() => {
    if (!background && document.hidden) {
      latest.current.audio.current?.pause();
      void latest.current.context.current?.suspend();
    } else if (background) void recover();
  }, [background]);
  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    const handlers: { [key: string]: () => void } = {
      play: () => {
        setMediaPaused(false);
        void latest.current.start();
      },
      pause: () => {
        latest.current.stop();
        setMediaPaused(true);
      },
      stop: () => {
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
    navigator.mediaSession.playbackState =
      options.live && !frozen
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
    setBackground,
    wakeEnabled,
    setWakeEnabled,
    wakeHeld,
    wakeError,
    frozen,
    mediaPaused,
    recover,
    wakeSupported: !!navigator.wakeLock,
  };
}
