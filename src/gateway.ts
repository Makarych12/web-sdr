import { gatewayEndpoints } from "./gatewayConfig";
const base = import.meta.env.VITE_GATEWAY_URL;
export const gatewayConfigured =
  import.meta.env.VITE_HOSTING !== "vercel" || Boolean(base?.trim());
export const gateway = gatewayEndpoints(base, location.origin);
