// Wire contract from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/handlers/search/codexSearch.ts (buildCodexSearchRequest / parseCodexSearchSse)
// as dispatched by open-sse/handlers/search.ts. Upstream output is validated and rebuilt, never relayed.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { classifyHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { resolveCodexAccountId } from "../../../shared/codexAccountId.js";
import {
  CODEX_SEARCH_ID, CODEX_SEARCH_ALIASES, CODEX_SEARCH_DEFAULT_MODEL, CODEX_SEARCH_EFFORTS,
  CODEX_SEARCH_TIME_RANGES, CODEX_SEARCH_CLIENT_VERSION, searchConfig,
} from "./config.js";

export class CodexSearchInputError extends Error {
  constructor() { super("Unsupported Codex web search request"); this.name = "CodexSearchInputError"; }
}
/** Fixed public text: upstream errors may contain credentials or internal details (source CodexSearchError). */
export class CodexSearchError extends Error {
  constructor(statusHint = 502) { super("Codex web search failed"); this.name = "CodexSearchError"; this.statusHint = statusHint; }
}
const invalid = () => { throw new CodexSearchInputError(); };

export const CODEX_SEARCH_MAX_BYTES = 4 * 1024 * 1024;
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const MAX_QUERY = 2_000;
const MAX_TITLE = 1_000;
const MAX_SNIPPET = 4_000;
const MAX_DOMAINS = 20;
const DOMAIN_RE = /^-?(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Efforts the source silently clamps to `low`; upstream rejects web_search with them (source fixture). */
const CLAMPED_EFFORTS = ["minimal", "none"];
const ALLOWED_FIELDS = ["query", "provider", "max_results", "search_type", "time_range", "domain_filter", "provider_options"];
const ALLOWED_OPTIONS = ["model", "reasoning_effort"];

/** Canonical id for a requested search provider spelling, or null when it is not Codex web search. */
export function resolveCodexSearchProviderId(id) {
  return id === CODEX_SEARCH_ID || CODEX_SEARCH_ALIASES.includes(id) ? CODEX_SEARCH_ID : null;
}

/** Same normalization as the local/source dispatcher: NFKC, trim, collapse whitespace. */
export function sanitizeCodexQuery(query) {
  if (!isString(query) || CONTROL_CHAR_RE.test(query)) invalid();
  const clean = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > MAX_QUERY) invalid();
  return clean;
}

const nonempty = (value) => (isString(value) && value.trim() ? value.trim() : undefined);

/**
 * Validates a /v1/search body into source CodexSearchParams before any submission.
 * Source behavior kept: news/time_range/domain_filter become instruction hints; model is
 * provider_options.model, then connection searchModel, then gpt-6-luna; minimal/none effort
 * clamps to low. Refused (source silently ignores or would throw later): unknown fields,
 * country/language/offset/content options, provider_options.baseUrl, unknown effort values,
 * malformed domains, non-web/news search types.
 */
export function buildCodexSearchParams(body, providerSpecificData = null) {
  if (!isRecord(body) || Object.keys(body).some((k) => !ALLOWED_FIELDS.includes(k) && body[k] !== undefined)) invalid();
  if (body.provider !== undefined && !resolveCodexSearchProviderId(body.provider)) invalid();
  if (body.search_type !== undefined && !searchConfig.searchTypes.includes(body.search_type)) invalid();
  if (body.max_results !== undefined && (!Number.isSafeInteger(body.max_results) || body.max_results < 1)) invalid();
  if (body.time_range !== undefined && !CODEX_SEARCH_TIME_RANGES.includes(body.time_range)) invalid();
  let domainFilter;
  if (body.domain_filter !== undefined) {
    if (!Array.isArray(body.domain_filter) || body.domain_filter.length > MAX_DOMAINS
      || body.domain_filter.some((d) => !isString(d) || !DOMAIN_RE.test(d))) invalid();
    domainFilter = body.domain_filter.map((d) => d.toLowerCase());
  }
  const options = body.provider_options;
  if (options !== undefined && (!isRecord(options) || Object.keys(options).some((k) => !ALLOWED_OPTIONS.includes(k) && options[k] !== undefined))) invalid();
  if (options?.model !== undefined && (!isString(options.model) || !MODEL_RE.test(options.model.trim()))) invalid();
  const requestedEffort = options?.reasoning_effort;
  if (requestedEffort !== undefined && !CODEX_SEARCH_EFFORTS.includes(requestedEffort) && !CLAMPED_EFFORTS.includes(requestedEffort)) invalid();
  const storedModel = nonempty(providerSpecificData?.searchModel);
  const model = nonempty(options?.model) || (storedModel && MODEL_RE.test(storedModel) ? storedModel : undefined) || CODEX_SEARCH_DEFAULT_MODEL;
  return {
    query: sanitizeCodexQuery(body.query),
    maxResults: Math.min(body.max_results ?? searchConfig.defaultMaxResults, searchConfig.maxMaxResults),
    searchType: body.search_type ?? "web",
    timeRange: body.time_range,
    domainFilter,
    model,
    effort: CODEX_SEARCH_EFFORTS.includes(requestedEffort) ? requestedEffort : "low",
  };
}

/** Source buildCodexSearchHints: domain and time constraints are instruction hints, NOT hard filters. */
export function buildCodexSearchHints(params) {
  const hints = [
    `Search the web and return only JSON: {"results":[{"title":"...","url":"...","description":"..."}]}. Return up to ${Math.min(10, Math.max(1, params.maxResults))} relevant results.`,
    "Use the web_search tool. Only return URLs actually observed in search sources or citations. Do not invent URLs.",
  ];
  if (params.searchType === "news") hints.push("Focus on recent news and prioritize the latest reporting.");
  if (params.timeRange && params.timeRange !== "any") hints.push(`Prefer results from the last ${params.timeRange}.`);
  const include = params.domainFilter?.filter((domain) => !domain.startsWith("-"));
  const exclude = params.domainFilter?.filter((domain) => domain.startsWith("-")).map((domain) => domain.slice(1));
  if (include?.length) hints.push(`Prefer these domains: ${include.join(", ")}.`);
  if (exclude?.length) hints.push(`Avoid these domains: ${exclude.join(", ")}.`);
  return hints;
}

/** Source buildCodexSearchRequest body, byte-for-byte field order. */
export function buildCodexSearchBody(params) {
  return {
    model: params.model,
    instructions: buildCodexSearchHints(params).join("\n"),
    input: [{ role: "user", content: [{ type: "input_text", text: params.query }] }],
    tools: [{ type: "web_search" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    reasoning: { effort: params.effort },
    stream: true,
    store: false,
  };
}

const safeHeader = (value, limit) => isString(value) && value.length > 0 && value.length <= limit && /^[\x21-\x7e]+$/.test(value);

/**
 * Source headers: Codex identity (User-Agent/originator/Version), bearer token
 * (apiKey, then OAuth accessToken, as the source dispatcher), JSON body, SSE accept,
 * and `chatgpt-account-id` from the selected connection. The account id uses the local
 * resolver (workspaceId first, as the source, then the other stored aliases / id_token).
 */
export function codexSearchHeaders(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  if (!safeHeader(token, 16_384)) invalid();
  const headers = {
    "User-Agent": `codex_cli_rs/${CODEX_SEARCH_CLIENT_VERSION}`,
    originator: "codex_cli_rs",
    Version: CODEX_SEARCH_CLIENT_VERSION,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  const accountId = resolveCodexAccountId(credentials?.providerSpecificData || {}, credentials?.idToken || null);
  if (accountId) {
    if (!safeHeader(accountId, 256)) invalid();
    headers["chatgpt-account-id"] = accountId;
  }
  return headers;
}

/** Source upstreamStatus: classify an upstream error object into a public status. */
export function upstreamStatus(value) {
  const error = isRecord(value) ? value : {};
  const text = `${error.code || ""} ${error.type || ""} ${error.message || ""}`.toLowerCase();
  if (/unauthorized|invalid_api_key|authentication/.test(text)) return 401;
  if (/forbidden|permission_denied/.test(text)) return 403;
  if (/rate_limit|quota|usage_limit|insufficient_quota/.test(text)) return 429;
  if (/overloaded|server_error|service_unavailable/.test(text)) return 503;
  if (/invalid_request|cannot be used|not supported/.test(text)) return 400;
  return 502;
}

/**
 * Source cleanUrl (http/https, no userinfo, strip only utm_source) plus the local SSRF
 * classification: non-public hosts (loopback, private, metadata) are never surfaced.
 */
export function safeResultUrl(value) {
  if (!isString(value) || value.length > 4096) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
  try { if (classifyHost(url.hostname) !== "public") return null; } catch { return null; }
  url.searchParams.delete("utm_source");
  return url.href;
}

const array = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (isRecord(value) ? value : {});
const text = (value, max) => {
  const clean = nonempty(value);
  return clean && clean.length <= max && !CONTROL_CHAR_RE.test(clean.replace(/[\n\r\t]/g, "")) ? clean : undefined;
};

function groundingKey(url) {
  const parsed = new URL(url);
  return parsed.hostname.toLowerCase().replace(/^www\./, "") + parsed.pathname.replace(/\/+$/, "");
}

function modelRows(output) {
  try {
    const json = output.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    return array(record(JSON.parse(json)).results).flatMap((value) => {
      const item = record(value);
      const url = safeResultUrl(item.url);
      return url ? [{ url, title: text(item.title, MAX_TITLE) || new URL(url).hostname,
        snippet: text(item.description, MAX_SNIPPET) || text(item.snippet, MAX_SNIPPET) || "" }] : [];
    });
  } catch {
    return [];
  }
}

function observe(state, value, target, title) {
  const url = safeResultUrl(value);
  if (!url) return;
  state.observed.add(groundingKey(url));
  target.push({ url, title: text(title, MAX_TITLE) || new URL(url).hostname, snippet: "" });
}

function parseBlock(block) {
  const lines = block.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (!data || data === "[DONE]") return null;
  let payload;
  try { payload = JSON.parse(data); } catch { throw new CodexSearchError(); }
  if (!isRecord(payload)) throw new CodexSearchError();
  return { type: nonempty(payload.type) || event, payload };
}

function handleEvent(state, type, payload) {
  if (type === "error" || type === "response.failed") {
    throw new CodexSearchError(upstreamStatus(payload.error || record(payload.response).error || payload));
  }
  if (type === "response.output_item.done") {
    const item = record(payload.item);
    if (item.type === "web_search_call") {
      state.calls++;
      const action = record(item.action);
      for (const source of array(action.sources)) observe(state, record(source).url, state.sources);
      if (action.type === "open_page") observe(state, action.url, state.sources);
    }
    if (item.type === "message") {
      for (const content of array(item.content)) {
        const part = record(content);
        if (isString(part.text)) state.messages.push(part.text);
        for (const annotation of array(part.annotations)) {
          const citation = record(annotation);
          if (citation.type === "url_citation") observe(state, citation.url, state.annotations, citation.title);
        }
      }
    }
  }
  if (type === "response.output_text.done" && isString(payload.text)) state.outputTexts.push(payload.text);
  if (type === "response.completed") {
    const response = record(payload.response);
    if (response.status && response.status !== "completed") throw new CodexSearchError();
    state.completed = true;
    state.usage = record(response.usage);
    const count = record(record(response.tool_usage).web_search).num_requests;
    if (Number.isSafeInteger(count) && count >= 0) state.searches = count;
  }
}

/**
 * Source parseCodexSearchSse: final snapshots only (never deltas), model JSON rows kept only
 * when grounded by an observed source/citation host+path, else annotations, else sources;
 * deduped by host+path, capped to min(10, maxResults). Requires response.completed and at
 * least one web_search_call. Local addition: non-public result hosts are dropped.
 */
export function parseCodexSearchSse(body, maxResults) {
  if (!isString(body) || Buffer.byteLength(body, "utf8") > CODEX_SEARCH_MAX_BYTES) throw new CodexSearchError();
  const state = { sources: [], annotations: [], messages: [], outputTexts: [], observed: new Set(), calls: 0, completed: false, searches: 0, usage: {} };
  for (const block of body.replace(/\r\n/g, "\n").split("\n\n")) {
    const event = parseBlock(block);
    if (event) handleEvent(state, event.type, event.payload);
  }
  if (!state.completed || state.calls === 0) throw new CodexSearchError();
  const grounded = (state.outputTexts.length ? state.outputTexts : state.messages)
    .flatMap(modelRows).filter((row) => state.observed.has(groundingKey(row.url)));
  const rows = grounded.length ? grounded : state.annotations.length ? state.annotations : state.sources;
  const seen = new Set();
  const results = rows.filter((row) => {
    const key = groundingKey(row.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Math.min(10, Math.max(1, maxResults)));
  return { results, searches: state.searches || state.calls, usage: state.usage };
}

/** Local normalizers.js makeResult shape (source passes no provider_raw for Codex). */
export function makeCodexSearchResult(item, idx, now) {
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
    citation: { provider: CODEX_SEARCH_ID, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

export const codexSearchAdapter = Object.freeze({
  buildUrl: () => searchConfig.baseUrl,
  buildHeaders: codexSearchHeaders,
  buildParams: buildCodexSearchParams,
  buildBody: buildCodexSearchBody,
  parse: parseCodexSearchSse,
});
