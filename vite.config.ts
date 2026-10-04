import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  if (mode === "production" && env.VITE_GATEWAY_URL) {
    const url = new URL(env.VITE_GATEWAY_URL);
    if (
      url.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw Error("Production gateway must be a public HTTPS URL");
  }
  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_HOSTING": JSON.stringify(
        process.env.VERCEL ? "vercel" : "node",
      ),
    },
    server: {
      proxy: {
        "/api": "http://localhost:8787",
        "/ws": { target: "ws://localhost:8787", ws: true },
      },
    },
  };
});
