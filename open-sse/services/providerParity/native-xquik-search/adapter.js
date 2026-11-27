// Wire contract from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/handlers/search/xquikSearch.ts (buildXquikSearchRequest / extractXquikSearchHits /
// normalizeXquikSearchResponse) as dispatched by open-sse/handlers/search.ts.
// Upstream output is validated and rebuilt into canonical x.com citations, never relayed.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  XQUIK_SEARCH_ID, XQUIK_SEARCH_ALIASES, XQUIK_QUERY_TYPES, XQUIK_TIME_RANGES, searchConfig,
} from "./config.js";

export const invalid = () => { throw new Error("Unsupported Xquik Search request or response"); };
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const MAX_QUERY = 2_000;
const MAX_TEXT = 100_000;
const MAX_ROWS = 1_000;
// Source XquikTweetSchema: numeric tweet id, X handle username. The id length bound is local.
const TWEET_ID_RE = /^\d{1,25}$/;
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
/** Request fields this native contract honors; everything else would be silently dropped by the source. */
const ALLOWED_FIELDS = ["query", "provider", "max_results", "search_type", "time_range", "provider_options"];
/**
 * Source v1SearchSchema forces search_type "x" for this provider, so a caller "web" is
 * canonicalized exactly as the source route does; "news" and anything else is refused.
 */
const ACCEPTED_SEARCH_TYPES = ["x", "web"];

/** Canonical id for a requested provider spelling, or null when it is not Xquik. */
export function resolveXquikSearchProviderId(id) {
  return id === XQUIK_SEARCH_ID || XQUIK_SEARCH_ALIASES.includes(id) ? XQUIK_SEARCH_ID : null;
}

/** The source forwards the (route-trimmed) query verbatim: X operators and quotes are preserved. */
export function sanitizeXquikQuery(query) {
  if (!isString(query) || CONTROL_CHAR_RE.test(query)) invalid();
  const clean = query.trim();
  if (!clean || clean.length > MAX_QUERY) invalid();
  return clean;
}

/** Source buildXquikSearchRequest headers + local tryDedicatedProvider token precedence: apiKey, then accessToken. */
export function xquikSearchHeaders(credentials) {
  const key = credentials?.apiKey || credentials?.accessToken;
  if (!isString(key) || !key.trim() || /[^\x21-\x7e]/.test(key)) invalid();
  return { Accept: "application/json", "x-api-key": key };
}

function queryTypeOf(body, credentials) {
  const option = body.provider_options?.queryType;
  if (option !== undefined) {
    // Source silently maps unknown values to "Latest"; refuse them instead of claiming support.
    if (!XQUIK_QUERY_TYPES.includes(option)) invalid();
    return option;
  }
  // Connection default (source getProviderSettingString providerSpecificData fallback).
  const configured = credentials?.providerSpecificData?.queryType;
  return configured === "Top" ? "Top" : "Latest";
}

/**
 * Source query string: { q, queryType: "Top" | "Latest", limit: min(maxResults, 20), sinceTime? }.
 * Fields the source would silently ignore (country, language, offset, domain_filter,
 * content_options, unknown provider_options) and non-X search types are refused before
 * any billable submission.
 */
export function buildXquikSearchParams(body, credentials, nowMs = Date.now()) {
  if (!isRecord(body) || Object.keys(body).some((k) => !ALLOWED_FIELDS.includes(k) && body[k] !== undefined)) invalid();
  if (body.provider !== undefined && !resolveXquikSearchProviderId(body.provider)) invalid();
  if (body.search_type !== undefined && !ACCEPTED_SEARCH_TYPES.includes(body.search_type)) invalid();
  if (body.max_results !== undefined && (!Number.isSafeInteger(body.max_results) || body.max_results < 1)) invalid();
  if (body.time_range !== undefined && !Object.hasOwn(XQUIK_TIME_RANGES, body.time_range)) invalid();
  if (body.provider_options !== undefined) {
    if (!isRecord(body.provider_options) || Object.keys(body.provider_options).some((k) => k !== "queryType")) invalid();
  }
  const q = sanitizeXquikQuery(body.query);
  const limit = Math.min(body.max_results ?? searchConfig.defaultMaxResults, searchConfig.maxMaxResults);
  const params = { q, queryType: queryTypeOf(body, credentials), limit };
  if (body.time_range !== undefined) params.sinceTime = new Date(nowMs - XQUIK_TIME_RANGES[body.time_range]).toISOString();
  return params;
}

/** Fixed origin + path; caller input only ever lands in the encoded query string. */
export function buildXquikSearchUrl(params) {
  const query = new URLSearchParams({ q: params.q, queryType: params.queryType, limit: String(params.limit) });
  if (params.sinceTime) query.set("sinceTime", params.sinceTime);
  return `${searchConfig.baseUrl}?${query}`;
}

/** Local normalizers.js makeResult shape (source passes title/url/snippet/published_at/author/source_type "x"). */
function makeResult(item, idx, now) {
  return {
    title: item.title,
    url: item.url,
    display_url: item.url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0],
    snippet: item.snippet,
    position: idx + 1,
    score: null,
    published_at: item.published_at,
    favicon_url: null,
    content: null,
    metadata: { author: item.author, language: null, source_type: "x", image_url: null },
    citation: { provider: XQUIK_SEARCH_ID, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

/**
 * Source extractXquikSearchHits + normalizeXquikSearchResponse: tweets[] rows that pass
 * XquikTweetSchema become { title: "@user" | "X post", url: canonical x.com status URL,
 * snippet: text, author, published_at: createdAt, source_type: "x" }; invalid rows are skipped.
 * Deviations (documented): a non-object envelope, an upstream `error`, or a missing/non-array
 * `tweets` is malformed (the source defaults to zero results); oversized text rows are skipped;
 * non-ISO createdAt becomes null; results are capped to the requested limit (source caps at 20
 * and the handler slices).
 */
export function normalizeXquikSearchResponse(data, limit, now = new Date().toISOString()) {
  if (!isRecord(data) || data.error || !Array.isArray(data.tweets) || data.tweets.length > MAX_ROWS) invalid();
  const kept = [];
  for (const tweet of data.tweets) {
    if (kept.length >= limit) break;
    if (!isRecord(tweet) || !isString(tweet.id) || !TWEET_ID_RE.test(tweet.id)) continue;
    if (!isString(tweet.text) || tweet.text.length > MAX_TEXT || CONTROL_CHAR_RE.test(tweet.text)) continue;
    if (tweet.createdAt !== undefined && !isString(tweet.createdAt)) continue;
    if (tweet.author !== undefined && (!isRecord(tweet.author) || !isString(tweet.author.username) || !X_HANDLE_RE.test(tweet.author.username))) continue;
    const author = tweet.author?.username ?? null;
    kept.push({
      title: author ? `@${author}` : "X post",
      url: author ? `https://x.com/${author}/status/${tweet.id}` : `https://x.com/i/status/${tweet.id}`,
      snippet: tweet.text,
      author,
      published_at: isString(tweet.createdAt) && ISO_DATE_RE.test(tweet.createdAt) ? tweet.createdAt : null,
    });
  }
  const results = kept.map((item, idx) => makeResult(item, idx, now));
  return { results, totalResults: results.length };
}

export const xquikSearchAdapter = Object.freeze({
  buildParams: buildXquikSearchParams, buildUrl: buildXquikSearchUrl,
  buildHeaders: xquikSearchHeaders, normalize: normalizeXquikSearchResponse,
});
