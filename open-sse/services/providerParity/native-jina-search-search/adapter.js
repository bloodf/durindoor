// Wire contract from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/handlers/search/jinaSearch.ts (buildJinaSearchRequest, extractJinaSearchItems)
// and open-sse/handlers/search.ts (normalizeJinaSearchResponse, makeResult).
// Inputs the source silently ignores are refused here before any billable submit;
// upstream output is validated and rebuilt, never relayed.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { JINA_SEARCH_ID, JINA_SEARCH_REQUEST_ALIASES, JINA_SEARCH_URL, searchConfig } from "./config.js";

export const invalid = () => { throw new Error("Unsupported Jina Search request or response"); };

const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const STRIP_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
// Source /v1/search schema: query trimmed 1..500 characters.
const MAX_QUERY = 500;
const MAX_PAGE = 100;
const MAX_ITEMS = 1000;
const LIMITS = Object.freeze({ title: 1_000, snippet: 8_000, content: 200_000, url: 4_096 });
const ALLOWED_FIELDS = Object.freeze([
  "query", "provider", "model", "max_results", "search_type", "country", "language",
  "time_range", "offset", "domain_filter", "content_options", "provider_options",
]);

/** Local sanitizeQuery semantics (control-byte refusal, NFKC, whitespace collapse) plus the source 500-char cap. */
export function sanitizeJinaQuery(query) {
  if (!isString(query) || CONTROL_RE.test(query)) invalid();
  const clean = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > MAX_QUERY) invalid();
  return clean;
}

/** Source buildJinaSearchRequest: Bearer from the selected connection (apiKey, then accessToken). */
export function jinaSearchHeaders(credentials) {
  const key = credentials?.apiKey || credentials?.accessToken;
  if (!isString(key) || !key.trim() || /[^\x21-\x7e]/.test(key)) invalid();
  return { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}` };
}

const empty = (value) => value === undefined || value === null ||
  (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);

function routedProvider(value) {
  if (value === undefined || value === null) return;
  if (!isString(value)) invalid();
  const id = value.endsWith("/search") ? value.slice(0, -"/search".length) : value;
  if (id !== JINA_SEARCH_ID && !JINA_SEARCH_REQUEST_ALIASES.includes(id)) invalid();
}

/**
 * Source envelope: { q, num, gl?, hl?, page? } where num = min(max_results || 5, 50)
 * and page = offset when offset > 0 (verbatim source mapping). Unsupported filters,
 * non-web search types, content options and provider passthrough are refused rather
 * than silently dropped as in the source.
 */
export function buildJinaSearchBody(body) {
  if (!isRecord(body) || Object.keys(body).some((k) => !ALLOWED_FIELDS.includes(k) && body[k] !== undefined)) invalid();
  routedProvider(body.provider);
  routedProvider(body.model);
  const q = sanitizeJinaQuery(body.query);
  if (body.search_type !== undefined && body.search_type !== "web") invalid();
  if (body.time_range !== undefined && body.time_range !== "any") invalid();
  if (!empty(body.domain_filter) || !empty(body.content_options) || !empty(body.provider_options)) invalid();
  let num = searchConfig.defaultMaxResults;
  if (body.max_results !== undefined) {
    if (!Number.isSafeInteger(body.max_results) || body.max_results < 1) invalid();
    num = Math.min(body.max_results, searchConfig.maxMaxResults);
  }
  const out = { q, num };
  if (body.country !== undefined) {
    if (!isString(body.country) || !/^[A-Za-z]{2}$/.test(body.country)) invalid();
    out.gl = body.country.toUpperCase();
  }
  if (body.language !== undefined) {
    if (!isString(body.language) || !/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,2})?$/.test(body.language)) invalid();
    out.hl = body.language;
  }
  if (body.offset !== undefined) {
    if (!Number.isSafeInteger(body.offset) || body.offset < 0 || body.offset > MAX_PAGE) invalid();
    if (body.offset > 0) out.page = body.offset;
  }
  return out;
}

/** Result links are returned to callers, never fetched; still only public http(s) without userinfo. */
export function safeResultUrl(value) {
  if (!isString(value) || !value || value.length > LIMITS.url || CONTROL_RE.test(value) || /\s/.test(value)) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) return null;
  if (isBlockedHost(parsed.hostname)) return null;
  return parsed.toString();
}

const clean = (value, max) => isString(value) ? value.replace(STRIP_CONTROL_RE, "").slice(0, max) : "";

/** Source extractJinaSearchItems: bare array, `data`, or `results`. Any other shape is malformed. */
function extractItems(data) {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) invalid();
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.results)) return data.results;
  // Jina answers an empty search with `data: null` and a 2xx status code.
  if (data.data === null && (data.code === undefined || data.code === 200)) return [];
  return invalid();
}

/** Local makeResult shape (open-sse/handlers/search/normalizers.js), provider_raw never populated. */
function makeResult(item, idx, now) {
  const url = item.url;
  const fullText = clean(item.content || item.text, LIMITS.content);
  return {
    title: clean(item.title, LIMITS.title),
    url,
    display_url: url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0],
    snippet: clean(item.description || item.snippet, LIMITS.snippet),
    position: idx + 1,
    score: null,
    published_at: null,
    favicon_url: null,
    content: fullText ? { format: "markdown", text: fullText, length: fullText.length } : null,
    metadata: { author: null, language: null, source_type: null, image_url: null },
    citation: { provider: JINA_SEARCH_ID, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

/**
 * Validate Jina items and rebuild unified SearchResults. Items with an unsafe or
 * missing URL are dropped and counted; the returned list is capped at maxResults.
 */
export function normalizeJinaSearch(data, maxResults, now = new Date().toISOString()) {
  const items = extractItems(data);
  if (items.length > MAX_ITEMS) invalid();
  let dropped = 0;
  const safe = [];
  for (const item of items) {
    const url = isRecord(item) ? safeResultUrl(item.url) : null;
    if (!url) { dropped += 1; continue; }
    safe.push({ ...item, url });
  }
  const results = safe.slice(0, maxResults).map((item, idx) => makeResult(item, idx, now));
  return { results, totalResults: results.length, dropped };
}

export const jinaSearchAdapter = Object.freeze({
  buildUrl: () => JINA_SEARCH_URL,
  buildHeaders: jinaSearchHeaders,
  buildBody: buildJinaSearchBody,
  normalize: normalizeJinaSearch,
});
