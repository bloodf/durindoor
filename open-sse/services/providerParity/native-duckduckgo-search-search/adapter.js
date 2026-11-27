// Wire contract from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/services/freeWebSearch.ts (freeWebSearch, parseDuckDuckGoLite) and
// open-sse/handlers/search.ts (tryDuckDuckGoFreeProvider result envelope).
// Upstream HTML is parsed into a bounded allow-listed shape, never relayed.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { DDG_FREE_ID, DDG_LITE_URL, DDG_USER_AGENT, searchConfig } from "./config.js";

export const invalid = () => { throw new Error("Unsupported DuckDuckGo search request or response"); };

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
export const MAX_QUERY_CHARS = 2000;
// Fields the local /v1/search route forwards. Only these may be present; the
// ones DuckDuckGo lite cannot honor must be absent/null (never silently dropped).
const ROUTE_FIELDS = ["query", "provider", "max_results", "search_type", "country", "language", "time_range",
  "offset", "domain_filter", "content_options", "provider_options"];
const UNSUPPORTED = ["country", "language", "time_range", "offset", "domain_filter", "content_options", "provider_options"];

/** Local search/index.js sanitizeQuery semantics plus a length bound. */
function cleanQuery(query) {
  if (!isString(query) || CONTROL_CHAR_RE.test(query)) invalid();
  const clean = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > MAX_QUERY_CHARS) invalid();
  return clean;
}

/**
 * Validate a core search body before anything leaves the gateway.
 * Returns the parameters the source handler derives: query, searchType ("web"
 * is the only registry type) and maxResults (default 5, clamped to 25 like the
 * local core clamps to maxMaxResults).
 */
export function parseSearchParams(body) {
  if (!isRecord(body) || Object.keys(body).some((k) => !ROUTE_FIELDS.includes(k) && body[k] !== undefined)) invalid();
  if (body.provider !== undefined && body.provider !== null && body.provider !== DDG_FREE_ID) invalid();
  for (const key of UNSUPPORTED) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (isRecord(value) && Object.keys(value).length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    invalid();
  }
  const searchType = body.search_type ?? searchConfig.searchTypes[0];
  if (!searchConfig.searchTypes.includes(searchType)) invalid();
  let maxResults = searchConfig.defaultMaxResults;
  if (body.max_results !== undefined && body.max_results !== null) {
    if (!Number.isSafeInteger(body.max_results) || body.max_results < 1 || body.max_results > 100) invalid();
    maxResults = Math.min(body.max_results, searchConfig.maxMaxResults);
  }
  return { query: cleanQuery(body.query), searchType, maxResults };
}

/** Exact source request: POST form `q=<query>` with the source headers and no credential. */
export function buildDuckDuckGoRequest(params) {
  return {
    url: DDG_LITE_URL,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": DDG_USER_AGENT,
        Accept: "text/html",
      },
      body: new URLSearchParams({ q: params.query }).toString(),
    },
  };
}

// Source parser regexes, hard-bounded against ReDoS.
const ANCHOR_RE = /<a\b([^>]*?class=['"][^'"]*result-link[^'"]*['"][^>]*)>([\s\S]{0,512}?)<\/a>/gi;
const HREF_RE = /href=['"]([^'"]+)['"]/i;
const SNIPPET_RE = /<td\b[^>]*?class=['"][^'"]*result-snippet[^'"]*['"][^>]*>([\s\S]{0,2048}?)<\/td>/gi;
export const MAX_HTML_BYTES = 256 * 1024;
const MAX_URL_CHARS = 2048;

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    // &amp; last so "&amp;lt;" survives as the literal "&lt;" (no double unescape).
    .replace(/&amp;/gi, "&");
}

function stripTags(html) {
  let text = decodeEntities(html);
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== previous);
  text = text.replace(/<[^>]*$/, "");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Source resolveResultUrl (uddg redirect decode, protocol-relative upgrade,
 * http(s)-only) plus local public-result hardening: embedded credentials,
 * literal internal/loopback/metadata hosts and oversized URLs are dropped.
 */
export function resolveResultUrl(href) {
  let candidate = href;
  const redirect = href.match(/[?&]uddg=([^&]+)/);
  if (redirect) {
    try { candidate = decodeURIComponent(redirect[1]); } catch { candidate = href; }
  } else if (href.startsWith("//")) {
    candidate = `https:${href}`;
  }
  candidate = decodeEntities(candidate);
  if (!/^https?:\/\//i.test(candidate) || candidate.length > MAX_URL_CHARS) return "";
  let parsed;
  try { parsed = new URL(candidate); } catch { return ""; }
  if (parsed.username || parsed.password || !parsed.hostname || isBlockedHost(parsed.hostname)) return "";
  return candidate;
}

/** Pure parser: result link N aligns with snippet N; missing snippet → "". */
export function parseDuckDuckGoLite(rawHtml) {
  if (!isString(rawHtml) || !rawHtml) return [];
  const html = rawHtml.length > MAX_HTML_BYTES ? rawHtml.slice(0, MAX_HTML_BYTES) : rawHtml;
  const snippets = [...html.matchAll(SNIPPET_RE)].map((m) => stripTags(m[1]));
  const results = [];
  let index = 0;
  for (const match of html.matchAll(ANCHOR_RE)) {
    const hrefMatch = match[1].match(HREF_RE);
    const title = stripTags(match[2]);
    if (hrefMatch && title) {
      const url = resolveResultUrl(hrefMatch[1]);
      if (url) results.push({ url, title, snippet: snippets[index] ?? "" });
    }
    index += 1;
  }
  return results;
}

/** DuckDuckGo's anti-bot interstitial; a 200/202 carrying it is not a "no results" answer. */
export function isAnomalyPage(html) {
  return isString(html) && /anomaly-modal|class=['"][^'"]*anomaly|bots use DuckDuckGo too/i.test(html.slice(0, MAX_HTML_BYTES));
}

/** Local normalizers.js makeResult shape (unified SearchResult). */
function makeResult(item, idx, now) {
  return {
    title: item.title,
    url: item.url,
    display_url: item.url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0],
    snippet: item.snippet,
    position: idx + 1,
    score: null,
    published_at: null,
    favicon_url: null,
    content: null,
    metadata: { author: null, language: null, source_type: null, image_url: null },
    citation: { provider: DDG_FREE_ID, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

/** Source tryDuckDuckGoFreeProvider success envelope (search_cost_usd 0, answer null). */
export function normalizeSearch(html, params, durationMs = 0, now = new Date().toISOString()) {
  const results = parseDuckDuckGoLite(html).slice(0, Math.max(1, params.maxResults)).map((r, i) => makeResult(r, i, now));
  return {
    provider: DDG_FREE_ID,
    query: params.query,
    results,
    answer: null,
    usage: { queries_used: 1, search_cost_usd: 0 },
    metrics: { response_time_ms: durationMs, upstream_latency_ms: durationMs, total_results_available: results.length },
    errors: [],
  };
}

export const duckduckgoSearchAdapter = Object.freeze({
  parseParams: parseSearchParams,
  buildRequest: buildDuckDuckGoRequest,
  normalize: normalizeSearch,
});
