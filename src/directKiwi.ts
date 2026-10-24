import { KiwiProtocol } from "../shared/kiwiProtocol.js";
/** Adapts the same Kiwi protocol to the existing connection lifecycle, without a proxy timeout. */
export class DirectKiwiSocket {
  readyState = 0;
  binaryType = "arraybuffer";
  receivedAudio = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose:
    | ((event: { code: number; reason: string; wasClean: boolean }) => void)
    | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private session: KiwiProtocol;
  private nativeSockets: WebSocket[] = [];
  get diagnosticState() { return this.nativeSockets.map(s => ({ channel: new URL(s.url).pathname.split("/").slice(-1)[0], state: s.readyState })); }
  constructor(url: string, observe?: (socket: WebSocket) => void) {
    this.session = new KiwiProtocol(
      url,
      (value) => {
        if (this.readyState !== 1) return;
        if (value instanceof Uint8Array && value[0] === 1 && value.length > 1)
          this.receivedAudio = true;
        this.onmessage?.({
          data:
            value instanceof Uint8Array
              ? (value.slice().buffer as ArrayBuffer)
              : JSON.stringify(value),
        });
      },
      (target) => {
        if (target.protocol !== "wss:")
          throw Error("Для прямого приёма требуется защищённый WSS");
        const socket = new WebSocket(target);
        socket.binaryType = "arraybuffer";
        this.nativeSockets.push(socket);
        observe?.(socket);
        return {
          get readyState() {
            return socket.readyState;
          },
          send: (value: string) => socket.send(value),
          close: () => socket.close(),
          on: (type: string, callback: (...args: any[]) => void) => {
            if (type === "message")
              socket.addEventListener("message", (event) =>
                callback(new Uint8Array(event.data)),
              );
            else if (type === "close")
              socket.addEventListener("close", (event) =>
                callback(event.code, event.reason),
              );
            else if (type === "error")
              socket.addEventListener("error", () =>
                callback({ message: "WSS Kiwi недоступен" }),
              );
            else socket.addEventListener(type, callback);
          },
        };
      },
    );
    queueMicrotask(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.onopen?.({});
      }
    });
  }
  send(raw: string) {
    const command = JSON.parse(raw);
    if (command.type === "connect") this.session.start(command);
    else if (command.type === "tune") this.session.apply(command);
    else if (command.type === "disconnect") this.close();
  }
  setBackground(hidden: boolean) {
    this.session.setBackground(hidden);
  }
  resume() {
    this.session.resume();
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.session.close();
    this.onclose?.({ code: 1000, reason: "Закрыто клиентом", wasClean: true });
  }
}
