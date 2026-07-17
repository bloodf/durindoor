import {
  getProviderConnections,
  createProviderConnection,
  updateProviderConnection,
} from "@/lib/localDb";
import {
  ALLOWED_FIRECRAWL_HOSTS,
  validateFirecrawlHeaders,
  validateFirecrawlApiKey,
  validateFirecrawlBaseUrl,
  parseFirecrawlHeaders,
} from "open-sse/shared/firecrawlConfig.js";

export {
  ALLOWED_FIRECRAWL_HOSTS,
  validateFirecrawlHeaders,
  validateFirecrawlApiKey,
  validateFirecrawlBaseUrl,
  parseFirecrawlHeaders,
};

const PROBE_TIMEOUT_MS = 2000;

export async function probeFirecrawlEndpoint(baseUrl, { apiKey, headers } = {}) {
  const validation = validateFirecrawlBaseUrl(baseUrl);
  if (!validation.ok) return validation;

  const headerValidation = validateFirecrawlHeaders(headers);
  if (!headerValidation.ok) return headerValidation;

  const base = validation.url.origin;
  const init = {
    method: "GET",
    redirect: "error",
    headers: { "content-type": "application/json" },
  };
  if (apiKey) {
    init.headers.authorization = `Bearer ${apiKey}`;
  }
  if (headerValidation.headers) {
    Object.assign(init.headers, headerValidation.headers);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/test`, { ...init, signal: ctrl.signal });
    if (res.ok) {
      return { ok: true, status: res.status, message: "Firecrawl reachable" };
    }
    return { ok: false, status: res.status, error: `Firecrawl probe returned ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function stringifyHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return undefined;
  const entries = Object.entries(headers).filter(([, v]) => v !== undefined && v !== null);
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : undefined;
}

export async function upsertFirecrawlCustomConnection({
  baseUrl,
  apiKey,
  headers,
  isActive = true,
  testStatus = "pending",
}) {
  const all = await getProviderConnections({ provider: "firecrawl_custom" });
  const existing =
    all.find((c) => c.isActive) ||
    all.find((c) => c.name === "Firecrawl Local") ||
    all[0] ||
    null;

  const payload = {
    provider: "firecrawl_custom",
    authType: apiKey ? "apikey" : "noauth",
    name: "Firecrawl Local",
    isActive,
    testStatus,
    apiKey: typeof apiKey === "string" && apiKey.length > 0 ? apiKey : null,
    firecrawlHeaders: stringifyHeaders(headers) || null,
    providerSpecificData: { baseUrl },
  };

  if (existing) {
    return await updateProviderConnection(existing.id, payload);
  }
  return await createProviderConnection(payload);
}

export async function probeDefaultFirecrawlEndpoints({ apiKey, headers } = {}) {
  const candidates = ["http://127.0.0.1:3002", "http://[::1]:3002"];
  for (const baseUrl of candidates) {
    const result = await probeFirecrawlEndpoint(baseUrl, { apiKey, headers });
    if (result.ok) return { ...result, baseUrl };
  }
  return { ok: false, error: "No Firecrawl instance found on default ports" };
}
