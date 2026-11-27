// Wire contract from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/handlers/search.ts `zaiSearchExecute` / `unwrapZaiContent` / `tryZaiMCPProvider`.
// The source drives @modelcontextprotocol/sdk over Streamable HTTP; this module
// holds the pure JSON-RPC envelopes, input validation and result normalization.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  searchConfig, ZAI_SEARCH_ID, ZAI_SEARCH_TOOL, MCP_CLIENT_INFO, MCP_PROTOCOL_VERSION,
} from "./config.js";

export class ZaiSearchInputError extends Error {
  constructor(message) { super(message); this.name = "ZaiSearchInputError"; }
}
export const invalid = (message = "Unsupported Z.AI search request") => { throw new ZaiSearchInputError(message); };

const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const MAX_QUERY_CHARS = 2000;
const MAX_DOMAINS = 20;
const MAX_ITEMS = 100;
const BODY_KEYS = new Set([
  "query", "provider", "model", "max_results", "search_type", "country", "language",
  "time_range", "offset", "domain_filter", "content_options", "provider_options",
]);
const absent = (v) => v === undefined || v === null;

/** Source buildAuthHeader for authHeader "bearer": apiKey first, then accessToken. */
export function zaiHeaders(credentials, { sessionId = null, protocolVersion = null } = {}) {
  const key = credentials?.apiKey || credentials?.accessToken;
  if (!isString(key) || !key.trim() || /[^\x21-\x7e]/.test(key)) invalid("Z.AI API key required");
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${key}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
  return headers;
}

/**
 * Validate a /v1/search core body before any network work. The source sends only
 * `search_query` and joined include domains; everything it would silently drop is
 * refused here so nothing is claimed that the upstream tool does not honor.
 */
export function validateSearchBody(body) {
  if (!isRecord(body)) invalid();
  for (const key of Object.keys(body)) if (!BODY_KEYS.has(key) && !absent(body[key])) invalid(`Unsupported Z.AI search field: ${key}`);
  if (!isString(body.query) || CONTROL_RE.test(body.query)) invalid("Z.AI search query must be text");
  const query = body.query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!query || query.length > MAX_QUERY_CHARS) invalid("Z.AI search query is empty or too long");
  if (!absent(body.search_type) && body.search_type !== "web") invalid("Z.AI search supports only search_type web");
  let maxResults = searchConfig.defaultMaxResults;
  if (!absent(body.max_results)) {
    if (!Number.isSafeInteger(body.max_results) || body.max_results < 1) invalid("Z.AI max_results must be a positive integer");
    maxResults = Math.min(body.max_results, searchConfig.maxMaxResults);
  }
  if (!absent(body.offset) && body.offset !== 0) invalid("Z.AI search does not support offset");
  for (const key of ["country", "language", "time_range", "content_options"]) {
    if (!absent(body[key])) invalid(`Z.AI search does not support ${key}`);
  }
  if (!absent(body.provider_options) && !(isRecord(body.provider_options) && Object.keys(body.provider_options).length === 0)) {
    invalid("Z.AI search does not accept provider_options");
  }
  const includes = [];
  if (!absent(body.domain_filter)) {
    if (!Array.isArray(body.domain_filter) || body.domain_filter.length > MAX_DOMAINS) invalid("Z.AI domain_filter must be a short list");
    for (const entry of body.domain_filter) {
      if (!isString(entry)) invalid("Z.AI domain_filter must contain hosts");
      if (entry.startsWith("-")) invalid("Z.AI search does not support excluded domains");
      const host = entry.trim().toLowerCase();
      if (!HOST_RE.test(host)) invalid("Z.AI domain_filter accepts hosts only");
      if (!includes.includes(host)) includes.push(host);
    }
  }
  return { query, maxResults, includes };
}

export function buildInitializeRequest(id) {
  return {
    jsonrpc: "2.0", id, method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { ...MCP_CLIENT_INFO } },
  };
}
export function buildInitializedNotification() {
  return { jsonrpc: "2.0", method: "notifications/initialized" };
}
/** Source arguments: `{ search_query }` plus `search_domain_filter: includes.join(",")`. No count is sent. */
export function buildToolCallRequest(id, params) {
  const args = { search_query: params.query };
  if (params.includes.length) args.search_domain_filter = params.includes.join(",");
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: ZAI_SEARCH_TOOL, arguments: args } };
}

/**
 * Split complete SSE events out of a buffer. Returns parsed JSON-RPC messages from
 * `data:` fields and the unconsumed remainder. Unparseable events are reported.
 */
export function drainSseEvents(buffer) {
  const messages = [];
  let malformed = false;
  const normalized = buffer.replace(/\r\n?/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop();
  for (const event of parts) {
    const data = event.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
    if (!data) continue;
    try { messages.push(JSON.parse(data)); } catch { malformed = true; }
  }
  return { messages, rest, malformed };
}

/** Pick the JSON-RPC response for `id` from a JSON body (object or batch array). */
export function findResponse(messages, id) {
  const list = Array.isArray(messages) ? messages : [messages];
  return list.find((m) => isRecord(m) && m.jsonrpc === "2.0" && m.id === id && ("result" in m || "error" in m)) ?? null;
}

/**
 * Source unwrapZaiContent: the text is JSON; either the results array directly or a
 * JSON string that itself encodes the array. Returns null when neither shape holds.
 */
export function unwrapZaiContent(rawText) {
  let parsed;
  try { parsed = JSON.parse(rawText); } catch { return null; }
  if (Array.isArray(parsed)) return parsed;
  if (!isString(parsed)) return null;
  let inner;
  try { inner = JSON.parse(parsed); } catch { return null; }
  return Array.isArray(inner) ? inner : null;
}

const text = (v, max) => (isString(v) ? v.slice(0, max) : "");
const optional = (v, max) => (isString(v) && v.length && v.length <= max ? v : null);
function publicLink(v) {
  if (!isString(v) || v.length > 4096) return null;
  const url = URL.parse(v);
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
  return url.href;
}
const withinIncludes = (link, includes) => {
  if (!includes.length) return true;
  const host = new URL(link).hostname.toLowerCase();
  return includes.some((d) => host === d || host.endsWith(`.${d}`));
};

function makeResult(providerId, item, idx, now) {
  const url = item.url;
  return {
    title: item.title,
    url,
    display_url: url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0],
    snippet: item.snippet,
    position: idx + 1,
    score: null,
    published_at: item.published_at,
    favicon_url: item.favicon_url,
    content: null,
    metadata: { author: null, language: null, source_type: item.source_type, image_url: null },
    citation: { provider: providerId, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

/**
 * Normalize an MCP `tools/call` result. Returns `{ results, totalResults }`, or
 * throws when the tool reported an error or the content is not the documented shape.
 * Items with a non-http(s) link or outside the requested include domains are dropped.
 */
export function normalizeZaiToolResult(result, params, { providerId = ZAI_SEARCH_ID, now = new Date().toISOString() } = {}) {
  if (!isRecord(result)) invalid("Invalid Z.AI search response");
  if (result.isError === true) {
    const error = new ZaiSearchInputError("Z.AI search tool error");
    error.toolError = true;
    throw error;
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const rawText = content.filter((c) => isRecord(c) && c.type === "text").map((c) => (isString(c.text) ? c.text : "")).join("\n");
  if (!rawText.trim()) return { results: [], totalResults: null };
  const items = unwrapZaiContent(rawText);
  if (!items) invalid("Invalid Z.AI search response");
  const safe = [];
  for (const item of items.slice(0, MAX_ITEMS)) {
    if (!isRecord(item)) continue;
    const link = publicLink(item.link);
    if (!link || !withinIncludes(link, params.includes)) continue;
    const icon = publicLink(item.icon);
    safe.push({
      title: text(item.title, 1000),
      url: link,
      snippet: text(item.content, 8000),
      published_at: optional(item.publish_date, 64),
      favicon_url: icon,
      source_type: optional(item.media, 128),
    });
  }
  const results = safe.slice(0, params.maxResults).map((item, idx) => makeResult(providerId, item, idx, now));
  return { results, totalResults: safe.length };
}

export const zaiSearchAdapter = Object.freeze({
  buildHeaders: zaiHeaders,
  validate: validateSearchBody,
  buildInitialize: buildInitializeRequest,
  buildInitialized: buildInitializedNotification,
  buildToolCall: buildToolCallRequest,
  normalize: normalizeZaiToolResult,
});
