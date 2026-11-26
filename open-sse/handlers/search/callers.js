/**
 * Search Provider Request Builders
 *
 * Ported from OmniRoute open-sse/handlers/search.ts (lines 223-610).
 * Builds HTTP request `{ url, init }` for 10 search providers.
 *
 * @typedef {Object} SearchProviderConfig
 * @property {string} id
 * @property {string} baseUrl
 * @property {string} [method]
 *
 * @typedef {Object} ContentOptions
 * @property {boolean} [snippet]
 * @property {boolean} [full_page]
 * @property {string}  [format]
 * @property {number}  [max_characters]
 *
 * @typedef {Object} SearchRequestParams
 * @property {string}   query
 * @property {string}   searchType
 * @property {number}   maxResults
 * @property {string}   [token]
 * @property {string}   [country]
 * @property {string}   [language]
 * @property {string}   [timeRange]
 * @property {number}   [offset]
 * @property {string[]} [domainFilter]
 * @property {ContentOptions}        [contentOptions]
 * @property {Record<string,unknown>} [providerOptions]
 * @property {Record<string,unknown>} [providerSpecificData]
 */

import { resolveSearchBaseUrl } from "./baseUrl.js";

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Split domain filter into includes / excludes (excludes prefixed with "-").
 * @param {string[]} [domainFilter]
 * @returns {{includes: string[], excludes: string[]}}
 */
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
export function parseDomainFilter(domainFilter) {
  if (!domainFilter?.length) return { includes: [], excludes: [] };
  const includes = domainFilter.filter((d) => !d.startsWith("-"));
  const excludes = domainFilter.filter((d) => d.startsWith("-")).map((d) => d.slice(1));
  return { includes, excludes };
}

/**
 * Read string setting from providerOptions first, then providerSpecificData.
 * @param {SearchRequestParams} params
 * @param {string} key
 * @returns {string|undefined}
 */
export function getProviderSetting(params, key) {
  const fromOptions = params.providerOptions?.[key];
  if (isString(fromOptions) && fromOptions.trim().length > 0) {
    return fromOptions.trim();
  }
  const fromProviderData = params.providerSpecificData?.[key];
  if (isString(fromProviderData) && fromProviderData.trim().length > 0) {
    return fromProviderData.trim();
  }
  return undefined;
}

/** The caller's `provider_options.<id>` object, or an empty one. */
function getProviderOptions(params, providerId) {
  const options = params.providerOptions?.[providerId];
  return options && isObject(options) && !Array.isArray(options) ? options : {};
}

/** Allow-listed copy, so a caller cannot add arbitrary upstream fields. */
function pickFields(source, keys) {
  if (!source || !isObject(source)) return {};
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

// `stream` and `outputSchema` are left out: both change the response into
// streamed synthesized output, which the JSON search contract cannot carry.
const EXA_OPTION_FIELDS = [
  "category", "userLocation", "moderation",
  "systemPrompt", "compliance", "startPublishedDate", "endPublishedDate"
];
// Query, result count, domains and country come from the generic request only.
const TAVILY_OPTION_FIELDS = [
  "time_range", "start_date", "end_date",
  "include_published_date", "filter_by_published_date",
  "include_favicon", "include_domains_mode", "language", "filter_by_language",
  "exact_match", "include_usage", "safe_search"
];
const TAVILY_TOPICS = new Set(["general", "news", "finance"]);

/** Operator connection settings, never caller options, control paid search features.
 * searchLimits supports maxResults (default 10), allowAdvanced and allowContent.
 * Content is limited to Exa text or Tavily raw content; nested expansions are dropped.
 */
function searchLimits(params) {
  const limits = params.providerSpecificData?.searchLimits || {};
  return {
    maxResults: Number.isInteger(limits.maxResults) && limits.maxResults > 0 ? Math.min(limits.maxResults, 100) : 10,
    allowAdvanced: limits.allowAdvanced === true,
    allowContent: limits.allowContent === true
  };
}

function limitedResultCount(value, maximum) {
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), maximum)) : Math.min(5, maximum);
}

/**
 * Resolve the search base URL, requiring caller-controlled overrides to be
 * public HTTP(S) targets. Provider defaults are trusted administrator config.
 *
 * The trust decision itself lives in `./baseUrl.js` (OmniRoute #12620): the
 * administrator's connection endpoint wins over a caller-supplied one, and a
 * stored credential may only travel to an administrator-authorized origin.
 *
 * @param {SearchProviderConfig} config
 * @param {SearchRequestParams} params
 * @returns {string}
 * @throws {import("../../utils/outboundUrlGuard.js").OutboundUrlGuardError} When an override is invalid or targets a private address.
 */
export function resolveBaseUrl(config, params) {
  return resolveSearchBaseUrl(config, params).baseUrl;
}

/**
 * Convert offset+maxResults to 1-indexed page number.
 * @param {number|undefined} offset
 * @param {number} maxResults
 * @returns {number|undefined}
 */
export function toPageNumber(offset, maxResults) {
  if (!isNumber(offset) || offset <= 0 || maxResults <= 0) return undefined;
  return Math.floor(offset / maxResults) + 1;
}

// ── Provider Request Builders ───────────────────────────────────────────

function buildSerperRequest(config, params) {
  const endpoint = params.searchType === "news" ? "/news" : "/search";
  const body = { q: params.query, num: params.maxResults };
  if (params.country) body.gl = params.country.toLowerCase();
  if (params.language) body.hl = params.language;
  return {
    url: `${resolveBaseUrl(config, params)}${endpoint}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": params.token },
      body: JSON.stringify(body)
    }
  };
}

function buildBraveRequest(config, params) {
  const endpoint = params.searchType === "news" ? "/news/search" : "/web/search";
  const qp = new URLSearchParams({ q: params.query, count: String(params.maxResults) });
  if (params.country) qp.set("country", params.country);
  if (params.language) qp.set("search_lang", params.language);
  return {
    url: `${resolveBaseUrl(config, params)}${endpoint}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": params.token }
    }
  };
}

function buildPerplexityRequest(config, params) {
  const body = { query: params.query, max_results: params.maxResults };
  if (params.country) body.country = params.country;
  if (params.language) body.search_language_filter = [params.language];
  if (params.domainFilter?.length) body.search_domain_filter = params.domainFilter;
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.token}` },
      body: JSON.stringify(body)
    }
  };
}

/** First day (YYYY-MM-DD) of a generic `time_range`; undefined for `any` or unknown values. */
function timeRangeStartDate(timeRange) {
  if (!timeRange || timeRange === "any") return undefined;
  const from = new Date();
  if (timeRange === "day") from.setUTCDate(from.getUTCDate() - 1);
  else if (timeRange === "week") from.setUTCDate(from.getUTCDate() - 7);
  else if (timeRange === "month" || timeRange === "year") {
    const day = from.getUTCDate();
    from.setUTCDate(1);
    if (timeRange === "month") from.setUTCMonth(from.getUTCMonth() - 1);
    else from.setUTCFullYear(from.getUTCFullYear() - 1);
    const lastDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate();
    from.setUTCDate(Math.min(day, lastDay));
  }
  else return undefined;
  return from.toISOString().slice(0, 10);
}

function buildExaRequest(config, params) {
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const exa = getProviderOptions(params, "exa");
  const limits = searchLimits(params);
  const body = {
    query: params.query,
    numResults: limitedResultCount(params.maxResults, limits.maxResults),
    type: limits.allowAdvanced && ["deep", "deep-reasoning"].includes(exa.type) ? exa.type : "auto",
    // Exa reads content options only under `contents`.
    contents: { text: limits.allowContent && exa.contents?.text !== false, highlights: true }
  };
  if (includes.length) body.includeDomains = includes;
  if (excludes.length) body.excludeDomains = excludes;
  if (params.searchType === "news") body.category = "news";
  const publishedAfter = timeRangeStartDate(params.timeRange);
  if (publishedAfter && exa.endPublishedDate === undefined) body.startPublishedDate = `${publishedAfter}T00:00:00.000Z`;
  Object.assign(body, pickFields(exa, EXA_OPTION_FIELDS));
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": params.token },
      body: JSON.stringify(body)
    }
  };
}

const PARALLEL_MODES = new Set(["turbo", "fast", "basic", "advanced"]);

function buildParallelRequest(config, params) {
  if (params.searchType && params.searchType !== "web") throw new Error("Unsupported Parallel search type");
  if (params.query.length > 5000) throw new Error("Parallel query must not exceed 5000 characters");
  if (!Number.isInteger(params.maxResults) || params.maxResults < 1 || params.maxResults > 20) {
    throw new Error("Parallel max_results must be an integer from 1 to 20");
  }
  if (params.domainFilter && (!Array.isArray(params.domainFilter) || params.domainFilter.length > 200 || params.domainFilter.some((d) => !isString(d)))) {
    throw new Error("Parallel domain_filter must contain at most 200 domains");
  }
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const domains = (list) => list.map((d) => {
    const parsed = new URL(`https://${d.replace(/^https?:\/\//i, "")}`);
    if (!parsed.hostname) throw new Error("Invalid Parallel domain filter");
    return `${parsed.hostname}${parsed.pathname.replace(/\/$/, "")}`;
  });
  const requestedMode = getProviderSetting(params, "mode");
  const mode = requestedMode && PARALLEL_MODES.has(requestedMode) ? requestedMode : "fast";
  const objective = getProviderSetting(params, "objective") || (params.query.length > 200 ? params.query : undefined);
  if (objective?.length > 5000) throw new Error("Parallel objective must not exceed 5000 characters");
  const shortQuery = params.query.length > 200
    ? params.query.slice(0, 200).replace(/\s+\S*$/, "").trim() || params.query.slice(0, 200)
    : params.query;
  const body = {
    search_queries: [shortQuery],
    mode,
    advanced_settings: {
      max_results: params.maxResults,
    },
  };

  if (objective) body.objective = objective;
  if (includes.length || excludes.length) {
    const policy = {};
    if (includes.length) policy.include_domains = domains(includes);
    if (excludes.length) policy.exclude_domains = domains(excludes);
    body.advanced_settings.source_policy = policy;
  }
  if (mode === "turbo" && [...(body.advanced_settings.source_policy?.include_domains || []), ...(body.advanced_settings.source_policy?.exclude_domains || [])].some((d) => d.includes("/"))) {
    throw new Error("Parallel turbo mode does not support path-prefix filters");
  }
  const maxChars = params.contentOptions?.max_characters;
  if (maxChars !== undefined) {
    if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("Parallel max_characters must be a positive integer");
    body.advanced_settings.excerpt_settings = { max_chars_per_result: maxChars };
  }

  const afterDate = timeRangeStartDate(params.timeRange);
  if (afterDate) {
    body.advanced_settings.source_policy = {
      ...(body.advanced_settings.source_policy || {}),
      after_date: afterDate,
    };
  }

  if (params.country) {
    const loc = params.country.toLowerCase();
    body.advanced_settings.location = loc === "uk" ? "gb" : loc;
  }

  const sessionId = getProviderSetting(params, "session_id");
  if (sessionId?.length > 1000) throw new Error("Parallel session_id must not exceed 1000 characters");
  if (sessionId) body.session_id = sessionId;

  return {
    // Keep the stored key on the registry endpoint, never client baseUrl overrides.
    url: config.baseUrl,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": params.token },
      body: JSON.stringify(body),
    },
  };
}

function buildTavilyRequest(config, params) {
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const tavily = getProviderOptions(params, "tavily");
  const limits = searchLimits(params);
  const searchTopic = TAVILY_TOPICS.has(params.searchType) ? params.searchType : "general";
  const body = {
    query: params.query,
    max_results: limitedResultCount(params.maxResults, limits.maxResults),
    topic: TAVILY_TOPICS.has(tavily.topic) ? tavily.topic : searchTopic
  };
  if (includes.length) body.include_domains = includes;
  if (excludes.length) body.exclude_domains = excludes;
  if (params.country) body.country = params.country;
  // A caller's own date window replaces the generic one instead of mixing with it.
  const hasOwnWindow = ["time_range", "start_date", "end_date"].some((key) => tavily[key] !== undefined);
  const startDate = hasOwnWindow ? undefined : timeRangeStartDate(params.timeRange);
  if (startDate) body.start_date = startDate;
  Object.assign(body, pickFields(tavily, TAVILY_OPTION_FIELDS));
  // Ask for the provider's credit receipt so the ledger can retain real usage.
  body.include_usage = true;
  body.search_depth = limits.allowAdvanced && tavily.search_depth === "advanced" ? "advanced" : "basic";
  if (limits.allowContent && [true, "markdown", "text"].includes(tavily.include_raw_content)) {
    body.include_raw_content = tavily.include_raw_content;
  }
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.token}` },
      body: JSON.stringify(body)
    }
  };
}

// Context7 has no bearer requirement (authType "none"): anonymous calls work
// at a lower rate limit, a configured key just raises the quota.
function buildContext7Request(config, params) {
  const qp = new URLSearchParams({ query: params.query });
  const context7Headers = { Accept: "application/json" };
  if (params.token) context7Headers.Authorization = `Bearer ${params.token}`;
  return {
    url: `${resolveBaseUrl(config, params)}/search?${qp}`,
    init: {
      method: "GET",
      headers: context7Headers
    }
  };
}

function buildNimbleRequest(config, params) {
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const body = {
    query: params.query,
    max_results: params.maxResults,
    search_depth: "lite",
    output_format: "plain_text",
    focus: params.searchType === "news" ? "news" : "general"
  };
  if (params.country) body.country = params.country.toUpperCase();
  if (params.language) body.locale = params.language;
  if (params.timeRange && params.timeRange !== "any") body.time_range = params.timeRange;
  if (includes.length) body.include_domains = includes.slice(0, 50);
  if (excludes.length) body.exclude_domains = excludes.slice(0, 50);
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.token}` },
      body: JSON.stringify(body)
    }
  };
}

function buildGooglePseRequest(config, params) {
  const apiKey = params.token;
  const cx = getProviderSetting(params, "cx");
  if (!apiKey || !cx) {
    throw new Error("Google Programmable Search requires both apiKey and cx");
  }
  const qp = new URLSearchParams({
    key: apiKey,
    cx,
    q: params.query,
    num: String(Math.min(params.maxResults, 10))
  });
  if (params.country) qp.set("gl", params.country.toLowerCase());
  if (params.language) qp.set("hl", params.language);
  if (params.timeRange && params.timeRange !== "any") {
    const dateRestrictMap = { day: "d1", week: "w1", month: "m1", year: "y1" };
    const dateRestrict = dateRestrictMap[params.timeRange];
    if (dateRestrict) qp.set("dateRestrict", dateRestrict);
  }
  if (isNumber(params.offset) && params.offset > 0) {
    qp.set("start", String(Math.min(params.offset + 1, 91)));
  }
  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" }
    }
  };
}

function buildLinkupRequest(config, params) {
  const apiKey = params.token;
  if (!apiKey) throw new Error("Linkup Search requires an API key");

  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const requestedDepth = getProviderSetting(params, "depth");
  const depth =
  requestedDepth && ["fast", "standard", "deep"].includes(requestedDepth) ?
  requestedDepth :
  "standard";

  const body = {
    q: params.query,
    depth,
    outputType: "searchResults",
    maxResults: params.maxResults
  };
  if (includes.length) body.includeDomains = includes;
  if (excludes.length) body.excludeDomains = excludes;
  if (params.timeRange && params.timeRange !== "any") {
    const today = new Date();
    const toDate = today.toISOString().slice(0, 10);
    const from = new Date(today);
    if (params.timeRange === "day") from.setUTCDate(from.getUTCDate() - 1);
    if (params.timeRange === "week") from.setUTCDate(from.getUTCDate() - 7);
    if (params.timeRange === "month") from.setUTCMonth(from.getUTCMonth() - 1);
    if (params.timeRange === "year") from.setUTCFullYear(from.getUTCFullYear() - 1);
    body.fromDate = from.toISOString().slice(0, 10);
    body.toDate = toDate;
  }

  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    }
  };
}

function buildSearchApiRequest(config, params) {
  const apiKey = params.token;
  if (!apiKey) throw new Error("SearchAPI requires an API key");

  const qp = new URLSearchParams({
    engine: params.searchType === "news" ? "google_news" : "google",
    q: params.query,
    api_key: apiKey
  });
  if (params.country) qp.set("gl", params.country.toLowerCase());
  if (params.language) qp.set("hl", params.language);

  const page = toPageNumber(params.offset, params.maxResults);
  if (page) qp.set("page", String(page));

  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" }
    }
  };
}

function buildYouComRequest(config, params) {
  const apiKey = params.token;
  if (!apiKey) throw new Error("You.com Search requires an API key");

  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const qp = new URLSearchParams({
    query: params.query,
    count: String(Math.min(params.maxResults, 100))
  });

  if (params.timeRange && params.timeRange !== "any") qp.set("freshness", params.timeRange);
  if (isNumber(params.offset) && params.offset > 0 && params.maxResults > 0) {
    qp.set("offset", String(Math.min(Math.floor(params.offset / params.maxResults), 9)));
  }
  if (params.country) qp.set("country", params.country);
  if (params.language) qp.set("language", params.language);
  if (includes.length) qp.set("include_domains", includes.join(","));
  if (excludes.length) qp.set("exclude_domains", excludes.join(","));

  if (params.contentOptions?.full_page) {
    qp.set("livecrawl", params.searchType === "news" ? "news" : "web");
    qp.append(
      "livecrawl_formats",
      params.contentOptions.format === "markdown" ? "markdown" : "html"
    );
  }

  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json", "X-API-Key": apiKey }
    }
  };
}

function buildSearxngRequest(config, params) {
  const baseUrl = resolveBaseUrl(config, params);
  const url = baseUrl.endsWith("/search") ? baseUrl : `${baseUrl}/search`;
  const qp = new URLSearchParams({
    q: params.query,
    format: "json",
    categories: params.searchType === "news" ? "news" : "general"
  });
  if (params.language) qp.set("language", params.language);
  if (params.timeRange && params.timeRange !== "any") qp.set("time_range", params.timeRange);

  const page = toPageNumber(params.offset, params.maxResults);
  if (page) qp.set("pageno", String(page));

  return {
    url: `${url}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" }
    }
  };
}

function buildOllamaRequest(config, params) {
  const apiKey = params.token;
  if (!apiKey) throw new Error("Ollama Search requires an API key");

  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: params.query, max_results: params.maxResults })
    }
  };
}

// GLM exposes coding-plan search as an MCP tool on the chat API key.
function buildGlmSearchRequest(config, params) {
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : null)
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `dd-${Date.now()}`,
        method: "tools/call",
        params: {
          name: "web_search_prime",
          arguments: { search_query: params.query, count: params.maxResults }
        }
      })
    }
  };
}

// ── Keenable (keyless public tier) ──────────────────────────────────────
// POST https://api.keenable.ai/v1/search/public
//   { query, max_results, site?, exclude_domains?, published_after? (YYYY-MM-DD) }
// Response: { results: [{ title, url, description, snippet, published_at }] }
// The endpoint is fixed: provider_options.baseUrl and stored connection URLs are
// not used, and `mode`, `objective`, `query_time` and the other API options are
// never sent. Filters the public tier cannot honor fail instead of being dropped.
const KEENABLE_SEARCH_URL = "https://api.keenable.ai/v1/search/public";
const KEENABLE_MAX_EXCLUDES = 1000;
const KEENABLE_TIME_RANGES = new Set(["any", "day", "week", "month", "year"]);
const KEENABLE_HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

function keenableHost(entry) {
  const host = isString(entry) ? entry.trim().toLowerCase() : "";
  if (!KEENABLE_HOST_RE.test(host)) throw new Error("Keenable domain filters accept hosts only");
  return host;
}

function buildKeenableRequest(config, params) {
  if (params.searchType && params.searchType !== "web") {
    throw new Error("Unsupported Keenable search type");
  }
  if (!Number.isInteger(params.maxResults) || params.maxResults < 1 || params.maxResults > 50) {
    throw new Error("Keenable max_results must be an integer from 1 to 50");
  }
  if (Number.isInteger(params.offset) && params.offset > 0) {
    throw new Error("Keenable search does not support offset");
  }
  if (params.timeRange && !KEENABLE_TIME_RANGES.has(params.timeRange)) {
    throw new Error("Unsupported Keenable time_range");
  }
  if (params.domainFilter && (!Array.isArray(params.domainFilter) || params.domainFilter.some((d) => !isString(d)))) {
    throw new Error("Keenable domain_filter must be a list of strings");
  }
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  if (excludes.length > KEENABLE_MAX_EXCLUDES) {
    throw new Error(`Keenable search accepts at most ${KEENABLE_MAX_EXCLUDES} excluded domains`);
  }
  const body = { query: params.query, max_results: params.maxResults };
  // `site` takes one host. Several includes are not sent; the normalizer filters results.
  const hosts = includes.map(keenableHost);
  if (hosts.length === 1) body.site = hosts[0];
  if (excludes.length) body.exclude_domains = excludes.map(keenableHost);
  const publishedAfter = timeRangeStartDate(params.timeRange);
  if (publishedAfter) body.published_after = publishedAfter;
  return {
    url: KEENABLE_SEARCH_URL,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Keenable-Title": "durindoor" },
      body: JSON.stringify(body)
    }
  };
}

// ── Dispatcher ──────────────────────────────────────────────────────────

const BUILDERS = {
  "keenable": buildKeenableRequest,
  "glm": buildGlmSearchRequest,
  "serper": buildSerperRequest,
  "brave-search": buildBraveRequest,
  "perplexity": buildPerplexityRequest,
  "exa": buildExaRequest,
  "parallel": buildParallelRequest,
  "tavily": buildTavilyRequest,
  "google-pse": buildGooglePseRequest,
  "linkup": buildLinkupRequest,
  "searchapi": buildSearchApiRequest,
  "youcom": buildYouComRequest,
  "searxng": buildSearxngRequest,
  "ollama": buildOllamaRequest,
  "context7": buildContext7Request,
  "nimble": buildNimbleRequest
};

/**
 * Dispatch to the correct provider builder by `provider.id`.
 * Falls back to generic POST + bearer auth for unknown providers.
 * @param {SearchProviderConfig} provider
 * @param {SearchRequestParams} params
 * @returns {{url: string, init: RequestInit}}
 */
export function buildSearchRequest(provider, params) {
  const builder = BUILDERS[provider.id];
  if (builder) return builder(provider, params);

  return {
    url: resolveBaseUrl(provider, params),
    init: {
      method: provider.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : null)
      },
      body: JSON.stringify({
        query: params.query,
        max_results: params.maxResults,
        search_type: params.searchType
      })
    }
  };
}
