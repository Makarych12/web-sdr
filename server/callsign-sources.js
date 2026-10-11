// Providers return complete records. The selector never merges identity fields.
export async function lookupInSources(
  call,
  providers,
  { timeoutMs = 8000, now = Date.now } = {},
) {
  for (const provider of providers) {
    if (provider.enabled === false) continue;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      provider.timeoutMs ?? timeoutMs,
    );
    try {
      const result = await provider.lookup(call, controller.signal);
      if (!result || result.source !== provider.id) continue;
      if (
        result.status === "found" ||
        result.status === "conflict" ||
        (result.status === "not_found" && provider.scope === "global")
      ) {
        return { ...result, retrievedAt: new Date(now()).toISOString() };
      }
      // A miss in a national database cannot establish a worldwide absence.
    } catch {
      /* Technical errors permit the next approved provider. */
    } finally {
      clearTimeout(timer);
    }
  }
  throw Object.assign(new Error("Сервис поиска временно недоступен."), {
    status: 503,
  });
}

// Explicit comparisons only; normal lookup does not fetch/merge multiple owners.
export function compareCallsignRecords(records) {
  const found = records.filter((r) => r.status === "found");
  const normalize = (value) =>
    String(value).trim().normalize("NFKC").toUpperCase();
  const differences = ["callsign", "name", "country"].filter(
    (field) =>
      new Set(
        found
          .map((r) => r[field])
          .filter(Boolean)
          .map(normalize),
      ).size > 1,
  );
  if (!differences.length) return { status: "consistent", records: found };
  return {
    status: "conflict",
    message:
      "Сведения источников расходятся. Владелец автоматически не выбран.",
    differences,
    records: found.map(({ source, callsign, name, country, retrievedAt }) => ({
      source,
      callsign,
      name,
      country,
      retrievedAt,
    })),
  };
}
