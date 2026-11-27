// Wire contract from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/handlers/search/kimiSearch.ts (buildKimiSearchRequest / normalizeKimiSearchResponse)
// as dispatched by open-sse/handlers/search.ts. Upstream output is validated and rebuilt, never relayed.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { classifyHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { KIMI_SEARCH_ID, KIMI_SEARCH_SOURCE_ALIASES, searchConfig } from "./config.js";

export const invalid = () => { throw new Error("Unsupported Kimi Search request or response"); };
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const MAX_QUERY = 2_000;
const MAX_TITLE = 1_000;
const MAX_SNIPPET = 10_000;
const MAX_TEXT = 200_000;
/** Request fields this native contract honors; everything else would be silently dropped by the source. */
const ALLOWED_FIELDS = ["query", "provider", "max_results", "search_type"];

/** Canonical id for a requested search provider spelling, or null when it is not Kimi Search. */
export function resolveKimiSearchProviderId(id) {
  return id === KIMI_SEARCH_ID || KIMI_SEARCH_SOURCE_ALIASES.includes(id) ? KIMI_SEARCH_ID : null;
}

/** Same normalization as the local/source dispatcher: NFKC, trim, collapse whitespace. */
export function sanitizeKimiQuery(query) {
  if (!isString(query) || CONTROL_CHAR_RE.test(query)) invalid();
  const clean = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > MAX_QUERY) invalid();
  return clean;
}

/** Source buildKimiSearchRequest + local tryDedicatedProvider token precedence: apiKey, then accessToken. */
export function kimiSearchHeaders(credentials) {
  const key = credentials?.apiKey || credentials?.accessToken;
  if (!isString(key) || !key.trim() || /[^\x21-\x7e]/.test(key)) invalid();
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}

/**
 * Source envelope: { text_query, limit: min(maxResults, maxMaxResults), include_content: true }.
 * maxResults defaults to defaultMaxResults (5). Fields the source would silently ignore
 * (country, language, time_range, offset, domain_filter, content/provider options) and
 * non-web search types are refused before any billable submission.
 */
export function buildKimiSearchBody(body) {
  if (!isRecord(body) || Object.keys(body).some((k) => !ALLOWED_FIELDS.includes(k) && body[k] !== undefined)) invalid();
  if (body.provider !== undefined && !resolveKimiSearchProviderId(body.provider)) invalid();
  if (body.search_type !== undefined && !searchConfig.searchTypes.includes(body.search_type)) invalid();
  if (body.max_results !== undefined && (!Number.isSafeInteger(body.max_results) || body.max_results < 1)) invalid();
  const text_query = sanitizeKimiQuery(body.query);
  const limit = Math.min(body.max_results ?? searchConfig.defaultMaxResults, searchConfig.maxMaxResults);
  return { text_query, limit, include_content: true };
}

const str = (v, max) => (isString(v) && v.length <= max && !CONTROL_CHAR_RE.test(v.replace(/[\n\r\t]/g, "")) ? v : "");

/** Public http(s) URL without embedded credentials; anything else is dropped from results. */
export function safeResultUrl(value) {
  if (!isString(value) || value.length > 4096) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  try { if (classifyHost(url.hostname) !== "public") return null; } catch { return null; }
  return url.toString();
}

/** Local normalizers.js makeResult shape (the source passes no provider_raw for Kimi). */
function makeResult(item, idx, now) {
  const url = item.url;
  return {
    title: item.title,
    url,
    display_url: url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0],
    snippet: item.snippet,
    position: idx + 1,
    score: null,
    published_at: item.published_at || null,
    favicon_url: null,
    content: item.full_text ? { format: "text", text: item.full_text, length: item.full_text.length } : null,
    metadata: { author: null, language: null, source_type: null, image_url: null },
    citation: { provider: KIMI_SEARCH_ID, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

/**
 * Source normalizeKimiSearchResponse: search_results[] -> { title, url, snippet || "",
 * published_at: date, full_text: text || undefined, text_format: "text" }, totalResults = count.
 * Deviations (documented): a non-object envelope or a non-array `search_results` is malformed
 * (the source silently returns zero results); rows without a safe public URL are dropped;
 * results are capped to the requested limit; total counts only surfaced rows.
 */
export function normalizeKimiSearchResponse(data, limit, now = new Date().toISOString()) {
  if (!isRecord(data) || data.error || !Array.isArray(data.search_results) || data.search_results.length > 1000) invalid();
  const kept = [];
  for (const item of data.search_results) {
    if (kept.length >= limit) break;
    if (!isRecord(item)) continue;
    const url = safeResultUrl(item.url);
    if (!url) continue;
    const date = isString(item.date) && /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+\-Z]{0,40})?$/.test(item.date) ? item.date : null;
    kept.push({ title: str(item.title, MAX_TITLE), url, snippet: str(item.snippet, MAX_SNIPPET), published_at: date, full_text: str(item.text, MAX_TEXT) || undefined });
  }
  const results = kept.map((item, idx) => makeResult(item, idx, now));
  return { results, totalResults: results.length };
}

export const kimiSearchAdapter = Object.freeze({
  buildUrl: () => searchConfig.baseUrl, buildHeaders: kimiSearchHeaders,
  buildBody: buildKimiSearchBody, normalize: normalizeKimiSearchResponse,
});
