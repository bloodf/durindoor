import { validateFirecrawlBaseUrl, validateFirecrawlHeaders, parseFirecrawlHeaders } from "open-sse/shared/firecrawlConfig.js";
// Returns normalized shape across all providers
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import {
  OutboundUrlGuardError,
  assertOutboundUrlAllowed,
  guardedProbeFetch
} from "../../utils/outboundUrlGuard.js";
import { sanitizeErrorMessageWithSecrets } from "../../utils/error.js";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_FORMAT = "markdown";

function getDefaultTimeoutMs() {
  const env = process.env.FIRECRAWL_TIMEOUT_MS;
  if (!env) return DEFAULT_TIMEOUT_MS;
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function getDefaultFormat() {
  return process.env.FIRECRAWL_DEFAULT_FORMAT || DEFAULT_FORMAT;
}

/**
 * @typedef {Object} FetchResult
 * @property {boolean} success
 * @property {number} [status]
 * @property {string} [error]
 * @property {Object} [data]
 */

/**
 * Fetch with timeout abort through the shared DNS-pinned outbound URL guard.
 * Manual redirects prevent a validated public endpoint from redirecting the
 * connection to a private or cloud-metadata address.
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
// Strip non-ASCII chars from header values (HTTP headers must be ByteString).
function sanitizeHeaders(headers) {
  if (!headers) return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isString(v) ? v.replace(/[^\x00-\xFF]/g, "").trim() : v;
  }
  return out;
}

async function tryFetch(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await guardedProbeFetch(url, { ...init, headers: sanitizeHeaders(init.headers), signal: ctrl.signal });
    return { ok: true, res };
  } catch (err) {
    const isAbort = err?.name === "AbortError";
    return { ok: false, timeout: isAbort, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function truncate(text, max) {
  if (!text || !isString(text)) return text || "";
  if (!max || max <= 0) return text;
  return text.length > max ? text.slice(0, max) : text;
}
function truncateUtf8(text, maxBytes) {
  if (!isString(text) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) return text || "";
  let bytes = 0;
  let end = 0;
  while (end < text.length) {
    const codePoint = text.codePointAt(end);
    const width = codePoint <= 0x7F ? 1 : codePoint <= 0x7FF ? 2 : codePoint <= 0xFFFF ? 3 : 4;
    if (bytes + width > maxBytes) break;
    bytes += width;
    end += codePoint > 0xFFFF ? 2 : 1;
  }
  return end === text.length ? text : text.slice(0, end);
}


function parseJinaTitle(text) {
  const m = String(text || "").match(/^\s*#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function buildData({ provider, url, title, format, text, links, costUsd, responseMs, upstreamMs }) {
  const data = {
    provider,
    url,
    title: title || null,
    content: { format, text: text || "", length: (text || "").length },
    metadata: { author: null, published_at: null, language: null },
    usage: { fetch_cost_usd: costUsd ?? null },
    metrics: { response_time_ms: responseMs, upstream_latency_ms: upstreamMs }
  };
  if (Array.isArray(links)) data.links = links;
  return data;
}

async function readJsonOrText(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {return { json: await res.json() };} catch {return { text: "" };}
  }
  return { text: await res.text() };
}

/**
 * Main handler.
 * @param {Object} params
 * @param {string} params.url
 * @param {string} [params.format]
 * @param {number} [params.maxCharacters]
 * @param {string} params.provider
 * @param {Object} [params.providerConfig]
 * @param {Object} [params.credentials]
 * @param {Function} [params.log]
 * @returns {Promise<FetchResult>}
 */
export async function handleFetchCore({ url, format, maxCharacters, provider, providerConfig, credentials, log }) {
  if (!url || !isString(url)) {
    return { success: false, status: 400, error: "url is required" };
  }
  if (!provider) {
    return { success: false, status: 400, error: "provider is required" };
  }

  // User-controlled fetch targets cross the trust boundary here. Validate the
  // target even when a third-party fetch provider receives it in a JSON body.
  try {
    assertOutboundUrlAllowed(url, "public-only");
  } catch (error) {
    if (error instanceof OutboundUrlGuardError) {
      return {
        success: false,
        status: error.code === "OUTBOUND_URL_INVALID" ? 400 : 403,
        error: error.message
      };
    }
    throw error;
  }

  const fmt = format || getDefaultFormat();
  const timeoutMs = providerConfig?.timeoutMs || getDefaultTimeoutMs();
  const apiKey = credentials?.apiKey || credentials?.key || credentials?.token || "";
  const costPerQuery = providerConfig?.costPerQuery ?? null;
  const startedAt = Date.now();

  try {
    if (provider === "firecrawl" || provider === "firecrawl_custom") {
      return await runFirecrawl({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt, provider, providerConfig, credentials });
    }
    if (provider === "jina-reader") {
      return await runJina({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "tavily") {
      return await runTavily({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "exa") {
      return await runExa({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "tinyfish") {
      return await runTinyfish({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "ollama") {
      return await runOllama({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt, providerConfig });
    }
    return { success: false, status: 400, error: `Unsupported provider: ${provider}` };
  } catch (err) {
    log?.("fetch handler error:", err?.message || err);
    return { success: false, status: 502, error: err?.message || "Internal fetch error" };
  }
}

async function runFirecrawl({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt, provider, providerConfig, credentials }) {
  const isCustom = provider === "firecrawl_custom";

  if (!isCustom && !apiKey) {
    return { success: false, status: 400, error: "FIRECRAWL_API_KEY is required for the official Firecrawl provider" };
  }

  const baseUrl = validateCustomBaseUrl(provider, resolveFirecrawlBaseUrl(provider, providerConfig, credentials));
  const endpoint = isCustom ? "/v2/scrape" : "/v1/scrape";

  const rawHeaders = isCustom ? credentials?.firecrawlHeaders : null;
  let customHeaders = null;
  if (isCustom && rawHeaders !== undefined && rawHeaders !== null && rawHeaders !== "") {
    customHeaders = parseFirecrawlHeaders(rawHeaders);
    if (!customHeaders) {
      return { success: false, status: 400, error: "Invalid custom Firecrawl headers" };
    }
  }
  if (isCustom && customHeaders !== null) {
    const validation = validateFirecrawlHeaders(customHeaders);
    if (!validation.ok) {
      return { success: false, status: 400, error: `Invalid custom Firecrawl headers: ${validation.error}` };
    }
  }
  const headers = { "content-type": "application/json" };

  if (!isCustom && apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  } else if (isCustom && apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  if (customHeaders && isObject(customHeaders)) {
    Object.assign(headers, customHeaders);
  }

  const upstreamStart = Date.now();
  const r = await tryFetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    redirect: "error",
    headers,
    body: JSON.stringify({ url, formats: [fmt] })
  }, timeoutMs);

  if (!r.ok) {
    const status = r.timeout ? 504 : 502;
    const error = isCustom ? `Custom Firecrawl instance unreachable: ${r.error}` : r.error;
    return { success: false, status, error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    return { success: false, status: r.res.status, error: json?.error || `Firecrawl error: ${r.res.status}` };
  }
  const d = json?.data || {};
  const text = truncate(d.markdown || d.html || d.text || "", maxCharacters);
  const title = d.metadata?.title || null;
  return {
    success: true,
    data: buildData({
      provider, url, title, format: fmt, text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

function normalizeFirecrawlBaseUrl(validation) {
  const url = validation.url;
  const pathname = url.pathname.replace(/\/$/, "");
  return `${url.origin}${pathname}`;
}

function resolveFirecrawlBaseUrl(provider, providerConfig, credentials) {
  const isCustom = provider === "firecrawl_custom";
  if (isCustom) {
    const explicitCustom = credentials?.providerSpecificData?.baseUrl;
    if (explicitCustom) {
      const validated = validateFirecrawlBaseUrl(explicitCustom);
      if (validated.ok) return normalizeFirecrawlBaseUrl(validated);
      throw new Error(`Invalid self-hosted Firecrawl URL: ${validated.error}`);
    }
    if (providerConfig?.firecrawlBaseUrl) {
      const validated = validateFirecrawlBaseUrl(providerConfig.firecrawlBaseUrl);
      if (validated.ok) return normalizeFirecrawlBaseUrl(validated);
      throw new Error(`Invalid self-hosted Firecrawl URL: ${validated.error}`);
    }
    const envBaseUrl = process.env.FIRECRAWL_BASE_URL;
    if (envBaseUrl && validateFirecrawlBaseUrl(envBaseUrl).ok) {
      return envBaseUrl.replace(/\/$/, "");
    }
    return "http://127.0.0.1:3002";
  }
  return providerConfig?.firecrawlBaseUrl || process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev";
}

function validateCustomBaseUrl(provider, rawUrl) {
  if (provider !== "firecrawl_custom") return rawUrl;
  const validation = validateFirecrawlBaseUrl(rawUrl);
  if (!validation.ok) throw new Error(`Invalid self-hosted Firecrawl URL: ${validation.error}`);
  return normalizeFirecrawlBaseUrl(validation);
}

async function runJina({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }) {
  const target = `https://r.jina.ai/${encodeURIComponent(url)}`;
  const upstreamStart = Date.now();
  const r = await tryFetch(target, {
    method: "GET",
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const body = await r.res.text();
  if (!r.res.ok) {
    return { success: false, status: r.res.status, error: body?.slice(0, 500) || `Jina error: ${r.res.status}` };
  }
  const text = truncate(body, maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "jina-reader", url, title: parseJinaTitle(body), format: fmt, text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runTavily({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }) {
  const upstreamStart = Date.now();
  const r = await tryFetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : null)
    },
    body: JSON.stringify({ urls: [url], extract_depth: "basic" })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    return { success: false, status: r.res.status, error: json?.error || `Tavily error: ${r.res.status}` };
  }
  const first = json?.results?.[0] || {};
  const text = truncate(first.raw_content || "", maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "tavily", url, title: null, format: fmt, text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runExa({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }) {
  const upstreamStart = Date.now();
  const r = await tryFetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : null)
    },
    body: JSON.stringify({ ids: [url], text: true })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    return { success: false, status: r.res.status, error: json?.error || `Exa error: ${r.res.status}` };
  }
  const first = json?.results?.[0] || {};
  const text = truncate(first.text || "", maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "exa", url, title: first.title || null, format: fmt, text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runOllama({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt, providerConfig }) {
  const upstreamStart = Date.now();
  const r = await tryFetch(providerConfig.baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ url })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json, text: responseText } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    const rawError = isString(json?.error) ? json.error :
      isString(json?.error?.message) ? json.error.message :
      isString(json?.message) ? json.message :
      responseText || r.res.statusText || "upstream request failed";
    const error = sanitizeErrorMessageWithSecrets(rawError.slice(0, 500), [apiKey]);
    return { success: false, status: r.res.status, error: `Ollama upstream error (${r.res.status}): ${error}` };
  }
  if (!isString(json?.content) || !json.content.trim()) {
    return { success: false, status: 502, error: "Ollama response normalization failed: content must be a non-empty string" };
  }
  if (json.links !== undefined && !Array.isArray(json.links)) {
    return { success: false, status: 502, error: "Ollama response normalization failed: links must be an array" };
  }

  const byteLimited = truncateUtf8(json.content, providerConfig.truncateBytes);
  const text = truncate(byteLimited, maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "ollama", url, title: isString(json.title) ? json.title : null, format: fmt, text,
      links: json.links, costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runTinyfish({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }) {
  if (!apiKey) {
    return { success: false, status: 400, error: "TINYFISH_API_KEY is required for TinyFish Fetch" };
  }

  const upstreamStart = Date.now();
  const r = await tryFetch("https://api.fetch.tinyfish.ai", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": apiKey
    },
    body: JSON.stringify({
      urls: [url],
      format: fmt === "html" ? "html" : "markdown",
      ttl: 0
    })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    return { success: false, status: r.res.status, error: json?.error || `TinyFish error: ${r.res.status}` };
  }
  const first = json?.results?.[0];
  if (!first) {
    const err = json?.errors?.[0];
    return { success: false, status: 502, error: err?.message || err?.error || "TinyFish could not fetch the requested URL" };
  }
  const text = truncate(first.text || "", maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "tinyfish", url, title: first.title || null, format: fmt, text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}