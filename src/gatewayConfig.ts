export function gatewayEndpoints(base: string | undefined, origin: string) {
  const url = new URL(base?.trim() || origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Некорректный адрес шлюза");
  if (new URL(origin).protocol === "https:" && url.protocol !== "https:")
    throw Error("Для опубликованного сайта нужен HTTPS-шлюз");
  url.pathname = url.pathname.replace(/\/$/, "");
  const http = url.href.replace(/\/$/, "");
  const socket = new URL(http + "/ws");
  socket.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return { http, socket: socket.href };
}
