import WebSocket from "ws";
import { publicLookup, isPublicAddress } from "./catalog.js";
import { KiwiProtocol } from "../shared/kiwiProtocol.js";
export { modes, validateTune } from "../shared/kiwiProtocol.js";
export class KiwiSession extends KiwiProtocol {
  constructor(url, emit, options) {
    super(
      url,
      emit,
      (target) => {
        const ws = new WebSocket(target, {
          handshakeTimeout: 10000,
          followRedirects: true,
          maxRedirects: 3,
          lookup: publicLookup,
        });
        ws.on("redirect", (url) => {
          const u = new URL(url),
            host = u.hostname.replace(/^\[|\]$/g, "");
          if (
            !["ws:", "wss:"].includes(u.protocol) ||
            host === "localhost" ||
            host.endsWith(".local") ||
            (/^\d+\.\d+\.\d+\.\d+$/.test(host) && !isPublicAddress(host))
          )
            this.fail(
              "Небезопасный адрес перенаправления приёмника",
              "invalid_receiver",
              false,
            );
        });
        return ws;
      },
      options,
    );
  }
}
