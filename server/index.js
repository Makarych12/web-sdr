import { server, wss } from "./gateway.js";
const port = Number(process.env.PORT || 8787);
server.listen(port, "0.0.0.0", () =>
  console.log(`UR4MTN gateway listening on port ${port}`),
);
process.on("SIGTERM", () => {
  wss.clients.forEach((c) => c.close(1012, "Service restarting"));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
