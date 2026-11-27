// Wire contract from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/handlers/search/firecrawlSearch.ts (buildFirecrawlSearchRequest,
// collectFirecrawlSearchHits) and open-sse/handlers/search.ts (makeResult shape,
// computeSearchCostUsd with resultBlockSize). Fixed hosted origin only; the source's
// FIRECRAWL_BASE_URL / caller baseUrl overrides are not ported (self-hosted stays firecrawl_custom).
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { FIRECRAWL_ID, FIRECRAWL_SEARCH_TYPES, FIRECRAWL_TIME_RANGES, searchConfig } from "./config.js";

export const invalid = () => { throw new Error("Unsupported Firecrawl search request or response"); };

const BODY_FIELDS = ["query", "provider", "max_results", "search_type", "country", "language", "time_range",
  "offset", "domain_filter", "content_options", "provider_options"];
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const UNSAFE_TEXT = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const absent = (v) => v === undefined || v === null;
export const MAX_QUERY_CHARS = 2000;
export const MAX_DOMAIN_FILTERS = 50;

/** Source search.ts sanitizes the query the same way before dispatch. */
export function sanitizeQuery(query) {
  if (!isString(query) || CONTROL.test(query)) invalid();
  const clean = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > MAX_QUERY_CHARS) invalid();
  return clean;
}

/** Source authHeader "bearer"; local dispatch reads apiKey, then accessToken. */
export function firecrawlSearchHeaders(credentials) {
  const key = credentials?.apiKey || credentials?.accessToken;
  if (!isString(key) || !key.trim() || /[^\x21-\x7e]/.test(key)) invalid();
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}

function domainFilter(list) {
  if (absent(list)) return { includes: [], excludes: [] };
  if (!Array.isArray(list) || list.length > MAX_DOMAIN_FILTERS) invalid();
  const includes = [];
  const excludes = [];
  for (const entry of list) {
    if (!isString(entry)) invalid();
    const exclude = entry.startsWith("-");
    const domain = (exclude ? entry.slice(1) : entry).toLowerCase();
    if (!DOMAIN.test(domain)) invalid();
    (exclude ? excludes : includes).push(domain);
  }
  return { includes, excludes };
}

/**
 * Validate the local /v1/search core body and build the source v2 envelope:
 * { query, limit, sources: [web|news], country?, lang?, tbs?, includeDomains?, excludeDomains? }.
 * Inputs the source silently drops (offset, content_options, provider_options, unknown
 * search types/time ranges) are refused before any billable submission.
 */
export function buildFirecrawlSearchBody(body) {
  if (!isRecord(body) || Object.keys(body).some((k) => !BODY_FIELDS.includes(k) && body[k] !== undefined)) invalid();
  if (!absent(body.provider) && body.provider !== FIRECRAWL_ID) invalid();
  if (!absent(body.offset) && body.offset !== 0) invalid();
  if (!absent(body.content_options)) invalid();
  if (!absent(body.provider_options) && (!isRecord(body.provider_options) || Object.keys(body.provider_options).length)) invalid();
  const query = sanitizeQuery(body.query);
  const limit = absent(body.max_results) ? searchConfig.defaultMaxResults : body.max_results;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > searchConfig.maxMaxResults) invalid();
  const searchType = absent(body.search_type) ? "web" : body.search_type;
  if (!FIRECRAWL_SEARCH_TYPES.includes(searchType)) invalid();
  const out = { query, limit, sources: [searchType] };
  if (!absent(body.country)) {
    if (!isString(body.country) || !/^[A-Za-z]{2}$/.test(body.country)) invalid();
    out.country = body.country.toLowerCase();
  }
  if (!absent(body.language)) {
    if (!isString(body.language) || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(body.language)) invalid();
    out.lang = body.language;
  }
  if (!absent(body.time_range) && body.time_range !== "any") {
    const tbs = Object.hasOwn(FIRECRAWL_TIME_RANGES, body.time_range) ? FIRECRAWL_TIME_RANGES[body.time_range] : null;
    if (!tbs) invalid();
    out.tbs = tbs;
  }
  const { includes, excludes } = domainFilter(body.domain_filter);
  if (includes.length) out.includeDomains = includes;
  if (excludes.length) out.excludeDomains = excludes;
  return out;
}

/** Result links are published to the caller: http(s), no userinfo, public literal host. */
export function safePublicUrl(value) {
  if (!isString(value) || !value || value.length > 2048) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  if (!parsed.hostname || isBlockedHost(parsed.hostname)) return null;
  return parsed.href;
}
const cleanText = (value, max) => (isString(value) ? value.replace(UNSAFE_TEXT, "").trim().slice(0, max) : "");
const firstText = (...values) => values.find((v) => isString(v) && v.trim()) ?? "";

/** Local makeResult (open-sse/handlers/search/normalizers.js) shape for a vetted hit. */
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
    metadata: { author: null, language: null, source_type: item.source_type, image_url: item.image_url },
    citation: { provider: FIRECRAWL_ID, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

/**
 * Source collectFirecrawlSearchHits field precedence over the v2 `data.{web|news}` bucket.
 * A malformed envelope throws (the caller treats it as completed-but-unusable); unsafe or
 * empty-URL hits are dropped and counted, never relayed.
 */
export function normalizeFirecrawlSearch(raw, request, now = new Date().toISOString()) {
  if (!isRecord(raw) || raw.success === false || raw.error !== undefined || !isRecord(raw.data)) invalid();
  const searchType = request.sources[0];
  const bucket = raw.data[searchType];
  if (bucket !== undefined && bucket !== null && !Array.isArray(bucket)) invalid();
  const items = Array.isArray(bucket) ? bucket : [];
  if (items.length > 1000) invalid();
  const hits = [];
  let dropped = 0;
  for (const item of items) {
    const meta = isRecord(item?.metadata) ? item.metadata : {};
    const url = isRecord(item) ? safePublicUrl(firstText(item.url, meta.sourceURL, item.link)) : null;
    if (!url) { dropped += 1; continue; }
    const longText = firstText(item.markdown, item.content).slice(0, 300);
    const published = firstText(item.date, item.published_at, meta.publishedTime);
    hits.push({
      title: cleanText(firstText(item.title, meta.title), 500),
      url,
      snippet: cleanText(firstText(item.description, item.snippet) || longText, 1000),
      published_at: published && published.length <= 64 && !CONTROL.test(published) ? published : null,
      image_url: safePublicUrl(item.imageUrl),
      source_type: searchType === "news" ? "news" : null,
    });
  }
  const results = hits.slice(0, request.limit).map((hit, idx) => makeResult(hit, idx, now));
  return { results, totalResults: results.length, dropped };
}

/** Source computeSearchCostUsd: costPerQuery per started resultBlockSize block, at least one. */
export function resultBlocks(resultCount) {
  return Math.max(1, Math.ceil(resultCount / searchConfig.resultBlockSize));
}
export function estimatedSearchCostUsd(resultCount) {
  return Math.round(searchConfig.costPerQuery * resultBlocks(resultCount) * 1e6) / 1e6;
}

export const firecrawlSearchAdapter = Object.freeze({
  buildUrl: () => searchConfig.baseUrl, buildHeaders: firecrawlSearchHeaders,
  buildBody: buildFirecrawlSearchBody, normalize: normalizeFirecrawlSearch,
});
