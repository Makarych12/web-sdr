export function originAllowed(
  origin,
  host,
  allowed = process.env.ALLOWED_ORIGINS || "",
) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
      return false;
    return (
      url.host === host ||
      allowed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .includes(origin)
    );
  } catch {
    return false;
  }
}
