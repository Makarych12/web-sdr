export type ConnectionState = {
  phase: "idle" | "connecting" | "live" | "retrying" | "blocked";
  message: string;
  attempt: number;
  retryAt?: number;
};
export type StreamConfig = {
  receiver: string;
  frequency: number;
  mode: string;
  zoom: number;
  lowCut?: number;
  highCut?: number;
  viewCenter?: number;
  agc?: "fast" | "slow" | "off";
};
export type KiwiEvent = { type: string; [key: string]: unknown };
type Options = {
  getConfig: () => StreamConfig;
  onState: (s: ConnectionState) => void;
  onMessage: (v: KiwiEvent | Uint8Array) => void;
  onReset: () => void;
  onUnavailable?: (code: string, reason: string) => boolean;
  onDiagnostic?: (event: Record<string, unknown>) => void;
  socketFactory?: (url: string) => WebSocket;
  random?: () => number;
  url: string;
};
export class StreamConnection {
  desired = false;
  socket: WebSocket | null = null;
  private generation = 0;
  private attempts = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private options: Options;
  private lastAudioAt = 0;
  private startedAt = 0;
  private background = false;
  get hasFreshAudio() {
    return (
      this.desired &&
      this.socket?.readyState === 1 &&
      this.lastAudioAt > 0 &&
      Date.now() - this.lastAudioAt < 22000
    );
  }
  setBackground(hidden: boolean) {
    this.background = hidden;
  }
  recoverAfterSleep() {
    if (!this.desired) return;
    const age = Date.now() - (this.lastAudioAt || this.startedAt);
    if (!this.socket || this.socket.readyState > 1 || age >= 22000)
      this.reconnectNow();
  }
  constructor(options: Options) {
    this.options = options;
  }
  start() {
    this.desired = true;
    this.attempts = 0;
    this.failures = 0;
    this.connect();
  }
  stop() {
    this.desired = false;
    this.disposeSocket();
    this.options.onState({ phase: "idle", message: "Отключён", attempt: 0 });
  }
  switchReceiver() {
    if (this.desired) {
      this.attempts = 0;
      this.failures = 0;
      this.connect();
    }
  }
  reconnectNow() {
    if (this.desired) {
      this.attempts = 0;
      this.failures = 0;
      this.connect();
    }
  }
  private tuneTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTune = 0;
  tune() {
    if (!this.desired || this.socket?.readyState !== 1) return;
    const delay = Math.max(0, 80 - (Date.now() - this.lastTune));
    if (!delay) {
      this.flushTune();
      return;
    }
    if (this.tuneTimer === undefined)
      this.tuneTimer = setTimeout(() => {
        this.tuneTimer = undefined;
        this.flushTune();
      }, delay);
  }
  flushTune() {
    clearTimeout(this.tuneTimer);
    this.tuneTimer = undefined;
    if (this.desired && this.socket?.readyState === 1) {
      const { receiver, ...tune } = this.options.getConfig();
      this.socket.send(JSON.stringify({ type: "tune", ...tune }));
      this.lastTune = Date.now();
    }
  }
  private disposeSocket() {
    ++this.generation;
    clearTimeout(this.tuneTimer);
    this.tuneTimer = undefined;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
    this.timer = undefined;
    this.watchdog = undefined;
    const old = this.socket;
    this.socket = null;
    if (old) {
      try {
        old.close();
      } catch {}
    }
    this.options.onReset();
  }
  private connect() {
    if (!this.desired) return;
    this.disposeSocket();
    const generation = this.generation;
    this.startedAt = Date.now();
    this.lastAudioAt = 0;
    this.options.onState({
      phase: "connecting",
      message: "Подключение…",
      attempt: this.attempts,
    });
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.retry("Нет сети. Ожидаем подключение.");
      return;
    }
    let socket: WebSocket;
    try {
      socket = (this.options.socketFactory ?? ((url) => new WebSocket(url)))(
        this.options.url,
      );
    } catch {
      this.retry("Шлюз недоступен");
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    let audio = 0,
      wf = 0,
      opened = Date.now(),
      lastAudio = opened,
      lastWaterfall = opened,
      healthy = false;
    const current = () =>
      this.desired && this.generation === generation && this.socket === socket;
    socket.onopen = () => {
      if (!current()) return;
      opened = lastAudio = lastWaterfall = Date.now();
      socket.send(
        JSON.stringify({ type: "connect", ...this.options.getConfig() }),
      );
    };
    socket.onmessage = (e) => {
      if (!current()) return;
      try {
        if (typeof e.data === "string") {
          const v = JSON.parse(e.data) as KiwiEvent;
          if (v.type === "heartbeat") {
            socket.send(JSON.stringify({ type: "heartbeat_ack", at: v.at }));
            return;
          }
          if (v.type === "error") {
            const reason =
              typeof v.message === "string" ? v.message : "Ошибка приёмника";
            this.failures++;
            this.options.onDiagnostic?.({
              type: "upstream_error",
              receiver: this.options.getConfig().receiver,
              code: v.code,
              reason,
              failures: this.failures,
            });
            const confirmedRefusal = ["badp", "too_busy", "down"].includes(
              String(v.code),
            );
            const changedReceiver =
              ((confirmedRefusal && this.failures >= 2) ||
                (v.code === "connection" && this.failures >= 3)) &&
              this.options.onUnavailable?.(String(v.code), reason);
            if (changedReceiver) {
              this.failures = 0;
              this.retry(`${reason} Подключаем другой публичный узел…`);
              return;
            }
            if (v.retryable === false && !confirmedRefusal) {
              this.desired = false;
              this.disposeSocket();
              this.options.onState({
                phase: "blocked",
                message: reason,
                attempt: this.attempts,
              });
            } else this.retry(reason, v.code === "too_busy" ? 15000 : 0);
            return;
          }
          this.options.onMessage(v);
        } else {
          const bytes = new Uint8Array(e.data);
          if (bytes[0] === 1) {
            audio++;
            lastAudio = Date.now();
            this.lastAudioAt = lastAudio;
          }
          if (bytes[0] === 2) {
            wf++;
            lastWaterfall = Date.now();
          }
          this.options.onMessage(bytes);
          if (audio && wf && !healthy) {
            healthy = true;
            this.options.onState({
              phase: "live",
              message: "В эфире",
              attempt: 0,
            });
          }
          if (audio >= 5 && wf >= 5 && Date.now() - opened >= 5000) {
            this.attempts = 0;
            this.failures = 0;
          }
        }
      } catch {
        this.retry("Ошибка данных от шлюза");
      }
    };
    socket.onerror = () => {
      if (current()) this.retry("Не удалось связаться со шлюзом");
    };
    socket.onclose = (event) => {
      if (!current()) return;
      const age = Math.round((Date.now() - opened) / 1000);
      this.options.onDiagnostic?.({
        type: "transport_close",
        receiver: this.options.getConfig().receiver,
        code: event.code,
        reason: event.reason,
        clean: event.wasClean,
        seconds: age,
      });
      this.retry(
        `Соединение закрыто (${event.code}${event.reason ? ": " + event.reason : ""}). Восстанавливаем текущий Kiwi.`,
      );
    };
    this.watchdog = setInterval(() => {
      if (
        current() &&
        Date.now() -
          (this.background ? lastAudio : Math.min(lastAudio, lastWaterfall)) >
          22000
      ) {
        this.options.onDiagnostic?.({
          type: "stream_timeout",
          receiver: this.options.getConfig().receiver,
          audioAge: Date.now() - lastAudio,
          waterfallAge: Date.now() - lastWaterfall,
        });
        this.retry("Нет данных потока. Восстанавливаем текущий Kiwi.");
      }
    }, 1000);
  }
  private retry(reason: string, minDelay = 0) {
    if (!this.desired) return;
    this.disposeSocket();
    const delay = Math.max(
      minDelay,
      Math.round(
        Math.min(30000, 1000 * 2 ** Math.min(5, this.attempts)) *
          (0.85 + (this.options.random ?? Math.random)() * 0.3),
      ),
    );
    this.attempts++;
    this.options.onState({
      phase: "retrying",
      message: reason,
      attempt: this.attempts,
      retryAt: Date.now() + delay,
    });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.connect();
    }, delay);
  }
}
