/** Only advertised HTTPS endpoints may bypass the gateway in a secure page. */
export function directEndpoint(
  url?: string,
  failed = false,
): string | undefined {
  if (!url || failed) return;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return;
  }
}
