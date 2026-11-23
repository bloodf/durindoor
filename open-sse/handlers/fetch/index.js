import { validateFirecrawlBaseUrl, validateFirecrawlHeaders, parseFirecrawlHeaders } from "open-sse/shared/firecrawlConfig.js";
import { parseContext7LibraryId } from "../../shared/context7LibraryId.js";
// Returns normalized shape across all providers
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import {
  OutboundUrlGuardError,
  assertOutboundUrlAllowed,
  guardedProbeFetch
} from "../../utils/outboundUrlGuard.js";
import { sanitizeErrorMessageWithSecrets } from "../../utils/error.js";
import { mediaAccounting } from "../mediaAccounting.js";
import { assertPublicUrlResolved } from "../../../src/shared/utils/ssrfGuard.js";

// Re-exported so the offline Context7 parser tests can assert that the fetch
// path and the search path share one library-id grammar.
export { parseContext7LibraryId };
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
 * @property {Object} [accounting] Internal raw-receipt accounting, outside normalized data.
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
    if (provider === "firecrawl_custom") await assertPublicUrlResolved(url);
  } catch (error) {
    if (provider === "firecrawl_custom" && error?.message?.includes("resolves to an internal host")) {
      return { success: false, status: 403, error: error.message };
    }
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
  const formats = providerConfig?.formats;
  if (Array.isArray(formats) && formats.length && !formats.includes(fmt)) {
    return {
      success: false,
      status: 400,
      error: `Unsupported format for ${provider}. Supported: ${formats.join(", ")}`
    };
  }
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
    if (provider === "parallel") {
      if (maxCharacters != null && maxCharacters !== 0 && (!Number.isInteger(maxCharacters) || maxCharacters < 1)) return { success: false, status: 400, error: "Parallel maxCharacters must be a positive integer" };
      const budget = Math.min(maxCharacters || 100000, 100000);
      return await runParallel({ url, timeoutMs, apiKey, maxCharacters: budget, costPerQuery, startedAt, baseUrl: "https://api.parallel.ai/v1/extract" });
    }
    if (provider === "tinyfish") {
      return await runTinyfish({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "keenable") {
      return await runKeenable({ url, fmt, timeoutMs, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "ollama") {
      return await runOllama({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt, providerConfig });
    }
    if (provider === "context7") {
      return await runContext7({ url, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "nimble") {
      return await runNimble({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "anysearch") {
      return await runAnysearch({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
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
  // Both the hosted API and DurinDoor's custom Firecrawl integration use v2.
  const endpoint = "/v2/scrape";

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
  const accounting = mediaAccounting(json, provider, "fetch");
  const d = json?.data || {};
  const text = truncate(d.markdown || d.html || d.text || "", maxCharacters);
  const title = d.metadata?.title || null;
  return {
    success: true,
    accounting,
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

export function resolveFirecrawlBaseUrl(provider, providerConfig, credentials) {
  const isCustom = provider === "firecrawl_custom";
  if (isCustom) {
    // Profile → Network → Firecrawl URL is the dashboard control for this host,
    // so a valid self-hosted value there wins over the host saved on the
    // connection (auto-configure writes both). The same setting also serves
    // hosted Firecrawl; a public URL there is not a self-hosted host and is skipped.
    const setting = providerConfig?.firecrawlBaseUrl ? validateFirecrawlBaseUrl(providerConfig.firecrawlBaseUrl) : null;
    if (setting?.ok) return normalizeFirecrawlBaseUrl(setting);
    const explicitCustom = credentials?.providerSpecificData?.baseUrl;
    if (explicitCustom) {
      const validated = validateFirecrawlBaseUrl(explicitCustom);
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
    headers: { "x-respond-with": fmt, ...(apiKey ? { authorization: `Bearer ${apiKey}` } : null) }
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const body = await r.res.text();
  if (!r.res.ok) {
    return { success: false, status: r.res.status, error: body?.slice(0, 500) || `Jina error: ${r.res.status}` };
  }
  let raw;
  try { raw = JSON.parse(body); } catch { /* Plain text has no usage receipt. */ }
  const accounting = mediaAccounting(raw, "jina-reader", "fetch");
  const text = truncate(body, maxCharacters);
  return {
    success: true,
    accounting,
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
    body: JSON.stringify({ urls: [url], extract_depth: "basic", format: fmt })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    return { success: false, status: r.res.status, error: json?.error || `Tavily error: ${r.res.status}` };
  }
  const accounting = mediaAccounting(json, "tavily", "fetch");
  const first = json?.results?.[0] || {};
  const text = truncate(first.raw_content || "", maxCharacters);
  return {
    success: true,
    accounting,
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
  const accounting = mediaAccounting(json, "exa", "fetch");
  const first = json?.results?.[0] || {};
  const text = truncate(first.text || "", maxCharacters);
  return {
    success: true,
    accounting,
    data: buildData({
      provider: "exa", url, title: first.title || null, format: fmt, text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runParallel({ url, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt, baseUrl }) {
  const upstreamStart = Date.now();
  const extractUrl = baseUrl;
  const headers = { "content-type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const r = await tryFetch(extractUrl, {
    method: "POST",
    redirect: "error",
    headers,
    body: JSON.stringify({
      urls: [url],
      advanced_settings: {
        full_content: { max_chars_per_result: maxCharacters }
      }
    })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    const message = json?.error?.message || `Parallel error: ${r.res.status}`;
    return { success: false, status: r.res.status, error: `${message}${json?.error?.ref_id ? ` (ref_id: ${json.error.ref_id})` : ""}` };
  }
  const failure = json?.errors?.find((e) => e.url === url);
  if (failure) {
    const errorType = isString(failure.error_type) && /^[a-z_]+$/.test(failure.error_type)
      && !/rate|limit|capacity|quota|overload|too_many/.test(failure.error_type) ? failure.error_type : "unknown";
    const targetStatus = Number.isInteger(failure.http_status_code) ? failure.http_status_code : "unknown";
    return { success: false, status: 422,
      error: `Parallel could not extract the requested URL (error_type: ${errorType}, target status: ${targetStatus})` };
  }
  const first = json?.results?.find((page) => page.url === url);
  const excerpts = Array.isArray(first?.excerpts) ? first.excerpts.filter((e) => isString(e) && e.trim()) : [];
  const raw = isString(first?.full_content) && first.full_content.trim() ? first.full_content : excerpts.join("\n\n");
  if (!raw.trim()) {
    return { success: false, status: 502, error: "Parallel returned no extractable content" };
  }
  const text = truncate(raw, maxCharacters);
  return {
    success: true,
    data: {
      ...buildData({ provider: "parallel", url, title: first.title,
        format: "markdown", text,
        costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs }),
      metadata: { author: null, published_at: first.publish_date || null, language: null },
    }
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

  const accounting = mediaAccounting(json, "ollama", "fetch");
  const byteLimited = truncateUtf8(json.content, providerConfig.truncateBytes);
  const text = truncate(byteLimited, maxCharacters);
  return {
    success: true,
    accounting,
    data: buildData({
      provider: "ollama", url, title: isString(json.title) ? json.title : null, format: fmt, text,
      links: json.links, costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

// Context7's `url` is a library reference, not a generic web URL. Accepted
// forms: "https://context7.com/owner/repo", "context7.com/owner/repo",
// "/owner/repo", "owner/repo" — each segment path-safe, no traversal.
// The grammar lives in open-sse/shared/context7LibraryId.js so the fetch
// executor and the search normalizer accept exactly the same library ids.

async function runContext7({ url, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }) {
  const libraryId = parseContext7LibraryId(url);
  if (!libraryId) {
    return {
      success: false,
      status: 400,
      error: 'Context7 fetch expects a library reference such as "https://context7.com/reactjs/react.dev" or "/reactjs/react.dev"'
    };
  }
  const upstreamStart = Date.now();
  const context7Headers = { Accept: "text/plain" };
  if (apiKey) context7Headers.Authorization = `Bearer ${apiKey}`;
  const r = await tryFetch(`https://context7.com/api/v1${libraryId}?type=llms.txt`, {
    method: "GET",
    headers: context7Headers
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const body = await r.res.text();
  if (!r.res.ok) {
    return { success: false, status: r.res.status, error: body?.slice(0, 500) || `Context7 error: ${r.res.status}` };
  }
  let raw;
  try { raw = JSON.parse(body); } catch { /* Plain text has no usage receipt. */ }
  const accounting = mediaAccounting(raw, "context7", "fetch");
  const text = truncate(body, maxCharacters);
  return {
    success: true,
    accounting,
    data: buildData({
      provider: "context7", url: `https://context7.com${libraryId}`, title: `Context7 docs: ${libraryId}`, format: "markdown", text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runNimble({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }) {
  if (!apiKey) {
    return { success: false, status: 400, error: "Nimble API key is required" };
  }
  const upstreamStart = Date.now();
  const r = await tryFetch("https://sdk.nimbleway.com/v1/extract", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, format: fmt === "html" ? "html" : "markdown" })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    return { success: false, status: r.res.status, error: json?.error || `Nimble error: ${r.res.status}` };
  }
  const accounting = mediaAccounting(json, "nimble", "fetch");
  const text = truncate(json?.data?.markdown || json?.data?.html || "", maxCharacters);
  return {
    success: true,
    accounting,
    data: buildData({
      provider: "nimble", url, title: null, format: fmt, text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

async function runAnysearch({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt }) {
  const upstreamStart = Date.now();
  const r = await tryFetch("https://api.anysearch.com/v1/extract", {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : null) },
    body: JSON.stringify({ url })
  }, timeoutMs);

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok || (isNumber(json?.code) && json.code !== 0)) {
    return { success: false, status: r.res.ok ? 502 : r.res.status, error: json?.message || json?.error || `AnySearch error: ${r.res.status}` };
  }
  const accounting = mediaAccounting(json, "anysearch", "fetch");
  const text = truncate(json?.data?.content || json?.data?.markdown || json?.content || "", maxCharacters);
  return {
    success: true,
    accounting,
    data: buildData({
      provider: "anysearch", url, title: json?.data?.title || null, format: fmt, text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}

// Keenable keyless public fetch: GET /v1/fetch/public?url=...[&max_chars=...]
// Response: { url, title, content, truncated, total_chars, author?, published_at? }
// Fixed official origin; `live`, `prompt` and any other API option is never sent.
// guardedProbeFetch never follows redirects, so a redirect is surfaced as an error.
const KEENABLE_FETCH_URL = "https://api.keenable.ai/v1/fetch/public";

function truncateCodePoints(text, max) {
  if (!max) return text;
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

async function runKeenable({ url, fmt, timeoutMs, maxCharacters, costPerQuery, startedAt }) {
  if (fmt !== "markdown") return { success: false, status: 400, error: `Unsupported Keenable format: ${fmt}` };
  if (maxCharacters != null && maxCharacters !== 0 && (!Number.isInteger(maxCharacters) || maxCharacters < 1)) {
    return { success: false, status: 400, error: "Keenable maxCharacters must be a positive integer" };
  }
  const qp = new URLSearchParams({ url });
  if (maxCharacters) qp.set("max_chars", String(maxCharacters));
  const upstreamStart = Date.now();
  const r = await tryFetch(`${KEENABLE_FETCH_URL}?${qp}`, {
    method: "GET",
    headers: { Accept: "application/json", "X-Keenable-Title": "durindoor" }
  }, timeoutMs);
  if (!r.ok) return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  const upstreamMs = Date.now() - upstreamStart;
  if (r.res.status >= 300 && r.res.status < 400) {
    return { success: false, status: 502, error: "Keenable redirected the request; redirects are not followed" };
  }
  const { json, text: responseText } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    const detail = [json?.message, json?.error, json?.detail].find((v) => isString(v) && v);
    return { success: false, status: r.res.status, error: detail || responseText?.slice(0, 500) || `Keenable error: ${r.res.status}` };
  }
  if (!isString(json?.content)) {
    return { success: false, status: 502, error: "Keenable returned no extractable content" };
  }
  const text = truncateCodePoints(json.content, maxCharacters);
  return {
    success: true,
    data: {
      ...buildData({ provider: "keenable", url, title: isString(json.title) ? json.title : null, format: fmt, text,
        costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs }),
      metadata: {
        author: isString(json.author) && json.author ? json.author : null,
        published_at: isString(json.published_at) && json.published_at ? json.published_at : null,
        language: null
      }
    }
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
  const accounting = mediaAccounting(json, "tinyfish", "fetch");
  const first = json?.results?.[0];
  if (!first) {
    const err = json?.errors?.[0];
    return { success: false, status: 502, error: err?.message || err?.error || "TinyFish could not fetch the requested URL" };
  }
  const text = truncate(first.text || "", maxCharacters);
  return {
    success: true,
    accounting,
    data: buildData({
      provider: "tinyfish", url, title: first.title || null, format: fmt, text,
      costUsd: costPerQuery, responseMs: Date.now() - startedAt, upstreamMs
    })
  };
}
