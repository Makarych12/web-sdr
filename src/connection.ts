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
  manualGain?: number;
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
  socket:
    | (WebSocket & {
        setBackground?: (hidden: boolean) => void;
        resume?: () => void;
      })
    | null = null;
  private generation = 0;
  private attempts = 0;
  private failures = 0;
  private reconnects = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private options: Options;
  private lastAudioAt = 0;
  private startedAt = 0;
  private background = false;
  private resumeUntil = 0;
  private lastTick = 0;
  private fallbackEligible = true;
  private receivedSessionAudio = false;
  setBackground(hidden: boolean) {
    if (this.background && !hidden) {
      this.lastTick = Date.now();
      this.resumeUntil = Date.now() + 5000;
    }
    if (hidden) this.fallbackEligible = false;
    this.background = hidden;
    this.socket?.setBackground?.(hidden);
  }
  recoverAfterSleep() {
    if (!this.desired || this.timer !== undefined) return;
    this.lastTick = Date.now();
    const age = Date.now() - (this.lastAudioAt || this.startedAt);
    if (!this.socket || this.socket.readyState > 1) this.retry("Соединение прервано после сна. Восстанавливаем текущий Kiwi.");
    else {
      if (age >= 22000) this.resumeUntil = Date.now() + 5000;
      this.socket.resume?.();
    }
  }
  constructor(options: Options) {
    this.options = options;
  }
  start() {
    this.desired = true;
    this.receivedSessionAudio = false;
    this.fallbackEligible = !this.background;
    this.attempts = 0;
    this.failures = 0;
    this.reconnects = 0;
    this.connect();
  }
  stop() {
    this.desired = false;
    this.disposeSocket();
    this.options.onState({ phase: "idle", message: "Отключён", attempt: 0 });
  }
  switchReceiver() {
    this.receivedSessionAudio = false;
    this.fallbackEligible = !this.background;
    if (this.desired) {
      this.attempts = 0;
      this.failures = 0;
      this.reconnects = 0;
      this.connect();
    }
  }
  reconnectNow() {
    if (this.desired) {
      this.attempts = 0;
      this.failures = 0;
      this.reconnects = 0;
      this.connect();
    }
  }
  private tuneTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTune = 0;
  tune() {
    if (!this.desired || this.socket?.readyState !== 1) return;
    const delay = Math.max(0, 40 - (Date.now() - this.lastTune));
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
    this.lastTune = -Infinity;
    const generation = this.generation;
    this.startedAt = Date.now();
    this.lastAudioAt = 0;
    this.resumeUntil = 0;
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
    this.socket.setBackground?.(this.background);
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
              fallbackEligible: this.fallbackEligible && !this.receivedSessionAudio &&
                !this.background && Date.now() - this.lastTick <= 5000,
            });
            if (v.retryable === false) {
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
            this.receivedSessionAudio = true;
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
    this.lastTick = Date.now();
    this.watchdog = setInterval(() => {
      const now = Date.now();
      if (now - this.lastTick > 5000) {
        this.fallbackEligible = false;
        this.resumeUntil = this.background ? 0 : now + 5000;
      }
      this.lastTick = now;
      if (
        current() &&
        (!this.background || this.resumeUntil > 0) &&
        Date.now() >= this.resumeUntil &&
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
    if(this.reconnects>=5){
      this.desired=false;
      this.options.onState({phase:'blocked',message:`${reason} Автовосстановление остановлено после 5 попыток. Нажмите подключение для нового сеанса.`,attempt:this.attempts});
      return;
    }
    this.reconnects++;
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
