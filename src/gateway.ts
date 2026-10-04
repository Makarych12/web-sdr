import { gatewayEndpoints } from "./gatewayConfig";
export const gatewayConfigured = true;
export const gateway = gatewayEndpoints(undefined, location.origin);
