import { isObject, isString } from "@/shared/utils/typeChecks.js";function stringifyHeaders(headers) {
  if (!headers || !isObject(headers) || Array.isArray(headers)) return undefined;
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
    null);

}

function connectionNeedsUpdate(existing, baseUrl, apiKey, headers) {
  if (!existing) return true;
  const effectiveApiKey = apiKey === undefined ? existing.apiKey || null : apiKey;
  const effectiveHeaderString = headers === undefined ?
  isString(existing.firecrawlHeaders) ? existing.firecrawlHeaders : null :
  stringifyHeaders(headers) || null;
  const existingHeaders = isString(existing.firecrawlHeaders) ? existing.firecrawlHeaders : null;
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
  override = false
} = {}) {
  const report = { changed: false, actions: [] };

  let baseUrl;
  let detected = { ok: false };
  if (settings.firecrawlBaseUrl && !override) {
    baseUrl = settings.firecrawlBaseUrl;
    report.actions.push(`using configured firecrawlBaseUrl ${baseUrl}`);
  } else {
    detected = await detectFirecrawl({ probe, apiKey, headers });
    baseUrl = detected.baseUrl;
  }

  if (!detected.ok && !baseUrl) {
    report.actions.push(`firecrawl not detected: ${detected.error}`);
    return {
      changed: false,
      wouldChange: false,
      detected: false,
      actions: report.actions,
      updates: {},
      connection: null
    };
  }

  let settingsChanged = false;
  if (settings.firecrawlBaseUrl !== baseUrl) {
    if (override || !settings.firecrawlBaseUrl) {
      report.actions.push(dryRun ? `would set firecrawlBaseUrl to ${baseUrl}` : `set firecrawlBaseUrl to ${baseUrl}`);
      settingsChanged = true;
    } else {
      report.actions.push(`preserving configured firecrawlBaseUrl ${settings.firecrawlBaseUrl}`);
    }
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
  const effectiveHeaders = headers === undefined && existing ? existing.firecrawlHeaders ? JSON.parse(existing.firecrawlHeaders) : {} : headers;
  const connection = needsUpdate && !dryRun ? {
    provider: "firecrawl_custom",
    authType: effectiveApiKey ? "apikey" : "noauth",
    name: "Firecrawl Local",
    isActive: true,
    testStatus: "pending",
    apiKey: effectiveApiKey,
    firecrawlHeaders: stringifyHeaders(effectiveHeaders) || null,
    providerSpecificData: { baseUrl }
  } : null;

  const updates = {};
  if (settingsChanged && !dryRun) {
    updates.firecrawlBaseUrl = baseUrl;
  }

  return {
    changed: !dryRun && (settingsChanged || needsUpdate),
    wouldChange: settingsChanged || needsUpdate,
    detected: true,
    running: !!detected.ok,
    baseUrl,
    actions: report.actions,
    updates,
    connection
  };
}

export async function upsertFirecrawlConnection(connection, upsert) {
  if (!upsert || !connection) return null;
  return upsert(connection);
}