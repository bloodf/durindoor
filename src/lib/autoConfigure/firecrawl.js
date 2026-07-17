function stringifyHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return undefined;
  const entries = Object.entries(headers).filter(([, v]) => v !== undefined && v !== null);
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : undefined;
}

async function findExistingFirecrawlConnection(listConnections) {
  if (!listConnections) return null;
  const all = await listConnections({ provider: "firecrawl_custom" });
  return (
    all.find((c) => c.isActive) ||
    all.find((c) => c.name === "Firecrawl Local") ||
    all[0] ||
    null
  );
}

function connectionNeedsUpdate(existing, baseUrl, apiKey, headers) {
  if (!existing) return true;
  const effectiveApiKey = apiKey === undefined ? existing.apiKey || null : apiKey;
  const effectiveHeaderString = headers === undefined
    ? (typeof existing.firecrawlHeaders === "string" ? existing.firecrawlHeaders : null)
    : stringifyHeaders(headers) || null;
  const existingHeaders = typeof existing.firecrawlHeaders === "string" ? existing.firecrawlHeaders : null;
  if (existing.provider !== "firecrawl_custom") return true;
  if (existing.providerSpecificData?.baseUrl !== baseUrl) return true;
  if ((existing.apiKey || null) !== effectiveApiKey) return true;
  if (existingHeaders !== effectiveHeaderString) return true;
  if (!existing.isActive) return true;
  return false;
}

export async function detectFirecrawl({ probe, apiKey, headers } = {}) {
  if (!probe) return { ok: false, error: "Firecrawl probe not available" };
  return probe({ apiKey, headers });
}

export async function configureFirecrawl(settings, {
  dryRun = false,
  probe,
  listConnections,
  apiKey = process.env.FIRECRAWL_API_KEY,
  headers,
} = {}) {
  const report = { changed: false, actions: [] };
  const detected = await detectFirecrawl({ probe, apiKey, headers });

  if (!detected.ok) {
    report.actions.push(`firecrawl not detected: ${detected.error}`);
    return {
      changed: false,
      wouldChange: false,
      detected: false,
      actions: report.actions,
      updates: {},
      connection: null,
    };
  }

  const baseUrl = detected.baseUrl;

  let settingsChanged = false;
  if (settings.firecrawlBaseUrl !== baseUrl) {
    report.actions.push(dryRun ? `would set firecrawlBaseUrl to ${baseUrl}` : `set firecrawlBaseUrl to ${baseUrl}`);
    settingsChanged = true;
  } else {
    report.actions.push(`firecrawlBaseUrl already ${baseUrl}`);
  }

  const existing = await findExistingFirecrawlConnection(listConnections);
  const needsUpdate = connectionNeedsUpdate(existing, baseUrl, apiKey, headers);

  if (needsUpdate) {
    report.actions.push(dryRun ? "would prepare firecrawl custom connection" : "firecrawl custom connection prepared");
  } else {
    report.actions.push("firecrawl custom connection already up to date");
  }

  const effectiveApiKey = apiKey === undefined && existing ? existing.apiKey || null : apiKey || null;
  const effectiveHeaders = headers === undefined && existing ? (existing.firecrawlHeaders ? JSON.parse(existing.firecrawlHeaders) : {}) : headers;
  const connection = needsUpdate && !dryRun ? {
    provider: "firecrawl_custom",
    authType: effectiveApiKey ? "apikey" : "noauth",
    name: "Firecrawl Local",
    isActive: true,
    testStatus: "pending",
    apiKey: effectiveApiKey,
    firecrawlHeaders: stringifyHeaders(effectiveHeaders) || null,
    providerSpecificData: { baseUrl },
  } : null;

  const updates = {};
  if (settingsChanged && !dryRun) {
    updates.firecrawlBaseUrl = baseUrl;
  }

  return {
    changed: !dryRun && (settingsChanged || needsUpdate),
    wouldChange: settingsChanged || needsUpdate,
    detected: true,
    baseUrl,
    actions: report.actions,
    updates,
    connection,
  };
}

export async function upsertFirecrawlConnection(connection, upsert) {
  if (!upsert || !connection) return null;
  return upsert(connection);
}
