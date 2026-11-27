// Native Z.AI web_search_prime MCP search contract (OmniRoute c71f0065a7, open-sse/handlers/search.ts).
// Closed-network: every upstream exchange is a scripted fetch mock.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  searchConfig, zaiSearchMetadata, ZAI_SEARCH_MCP_URL, MCP_CLIENT_INFO, MCP_PROTOCOL_VERSION,
  zaiSearchAdapter, unwrapZaiContent, drainSseEvents, handleZaiSearchNative,
} from "../../open-sse/services/providerParity/native-zai-search-search/index.js";
import glm from "../../open-sse/providers/registry/glm.js";

const credentials = { id: "connection-one", apiKey: "private-one" };
const item = { title: "DurinDoor", link: "https://example.com/docs", content: "Gateway", publish_date: "2026-09-10", icon: "https://example.com/i.png", media: "web" };
const toolText = (items) => ({ content: [{ type: "text", text: JSON.stringify(JSON.stringify(items)) }] });
const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const json = (v, status = 200, headers = {}) => Response.json(v, { status, headers });
const sse = (messages, headers = {}) => new Response(messages.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join(""),
  { status: 200, headers: { "content-type": "text/event-stream", ...headers } });
const initOk = (session = "sess-1", version = MCP_PROTOCOL_VERSION) =>
  json(rpc(0, { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: "zai" } }), 200, session ? { "mcp-session-id": session } : {});

/** Scripted MCP server: route by JSON-RPC method. */
function server({ initialize = () => initOk(), initialized = () => new Response(null, { status: 202 }), tool = () => json(rpc(1, toolText([item]))) } = {}) {
  return vi.fn(async (url, init) => {
    const msg = JSON.parse(init.body);
    if (msg.method === "initialize") return initialize(msg, init);
    if (msg.method === "notifications/initialized") return initialized(msg, init);
    if (msg.method === "tools/call") return tool(msg, init);
    throw new Error(`unexpected ${msg.method}`);
  });
}
const search = (opts = {}) => handleZaiSearchNative({ body: { query: "durindoor" }, credentials, ...opts });
const methods = (fetchImpl) => fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).method);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Z.AI native MCP search protocol (independent of registration)", () => {
  it("pins exact source registry fields and matches the local glm searchConfig endpoint/auth", () => {
    expect(searchConfig).toMatchObject({ id: "zai-search", baseUrl: "https://api.z.ai/api/mcp/web_search_prime/mcp", authType: "apikey", authHeader: "bearer",
      method: "POST", costPerQuery: 0, searchTypes: ["web"], defaultMaxResults: 5, maxMaxResults: 50, timeoutMs: 10_000, cacheTTLMs: 300_000 });
    expect(Object.isFrozen(searchConfig)).toBe(true);
    expect(zaiSearchMetadata.serviceKinds).toEqual(["webSearch"]);
    expect(zaiSearchMetadata.credentialProviders).toEqual(["glm", "zai"]);
    for (const key of ["baseUrl", "method", "authType", "authHeader", "costPerQuery", "defaultMaxResults", "maxMaxResults", "timeoutMs", "cacheTTLMs"]) {
      expect(glm.searchConfig[key]).toEqual(searchConfig[key]);
    }
  });

  it("runs initialize -> initialized -> tools/call with exact headers, session and source arguments", async () => {
    const fetchImpl = server();
    const result = await search({ fetchImpl, body: { query: "  durin   door ", max_results: 3, domain_filter: ["Example.com", "docs.rs"] } });
    expect(methods(fetchImpl)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    const [[u0, i0], [u1, i1], [u2, i2]] = fetchImpl.mock.calls;
    for (const [url, init] of [[u0, i0], [u1, i1], [u2, i2]]) {
      expect(url).toBe(ZAI_SEARCH_MCP_URL);
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(i0.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer private-one" });
    expect(JSON.parse(i0.body)).toEqual({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { ...MCP_CLIENT_INFO } } });
    const sessionHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer private-one", "mcp-session-id": "sess-1", "mcp-protocol-version": MCP_PROTOCOL_VERSION };
    expect(i1.headers).toEqual(sessionHeaders);
    expect(JSON.parse(i1.body)).toEqual({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(i2.headers).toEqual(sessionHeaders);
    // Source sends no count; max_results is applied locally.
    expect(JSON.parse(i2.body)).toEqual({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "web_search_prime", arguments: { search_query: "durin door", search_domain_filter: "example.com,docs.rs" } } });
    expect(result).toMatchObject({ success: true, status: 200 });
    const data = await result.response.json();
    expect(data).toEqual(expect.objectContaining({ provider: "zai-search", query: "durin door", answer: null, errors: [],
      usage: { queries_used: 1, search_cost_usd: 0 }, metrics: expect.objectContaining({ total_results_available: 1 }) }));
    expect(data.results).toEqual([{ title: "DurinDoor", url: "https://example.com/docs", display_url: "example.com/docs", snippet: "Gateway", position: 1, score: null,
      published_at: "2026-09-10", favicon_url: "https://example.com/i.png", content: null,
      metadata: { author: null, language: null, source_type: "web", image_url: null },
      citation: { provider: "zai-search", retrieved_at: expect.any(String), rank: 1 }, provider_raw: null }]);
    expect(result.accounting).toMatchObject({ modality: "search", cost: null, costStatus: "unknown", meta: { connectionId: "connection-one" } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("omits session headers when the server is sessionless and accepts SSE responses", async () => {
    const fetchImpl = server({
      initialize: () => sse([{ jsonrpc: "2.0", method: "notifications/message", params: {} }, rpc(0, { protocolVersion: "2025-03-26", capabilities: {} })]),
      tool: () => sse([{ jsonrpc: "2.0", method: "notifications/progress", params: {} }, rpc(1, toolText([item, { ...item, title: "Two" }]))]),
    });
    const result = await search({ fetchImpl, body: { query: "q", max_results: 1 } });
    expect(fetchImpl.mock.calls[2][1].headers).not.toHaveProperty("mcp-session-id");
    expect(fetchImpl.mock.calls[2][1].headers["mcp-protocol-version"]).toBe("2025-03-26");
    expect(result.data.results.map((r) => r.title)).toEqual(["DurinDoor"]);
    expect(result.data.metrics.total_results_available).toBe(2);
    expect(result.data.provider).toBe("zai-search");
    expect((await search({ fetchImpl: server(), providerId: "glm" })).data.results[0].citation.provider).toBe("glm");
  });

  it("stops reading an SSE stream once the matching response arrives", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(rpc(1, toolText([item])))}\n\n`)); },
      cancel() { cancelled = true; },
    });
    const fetchImpl = server({ tool: () => new Response(stream, { headers: { "content-type": "text/event-stream" } }) });
    const result = await search({ fetchImpl });
    expect(result.success).toBe(true);
    expect(cancelled).toBe(true);
  });

  it("isolates two credentials: each call has its own bearer, session and connection identity", async () => {
    let n = 0;
    const fetchImpl = server({ initialize: () => initOk(`sess-${++n}`) });
    const one = await search({ fetchImpl });
    const two = await search({ fetchImpl, credentials: { connectionId: "connection-two", accessToken: "private-two" } });
    const calls = fetchImpl.mock.calls.map(([, init]) => [init.headers.Authorization, init.headers["mcp-session-id"]]);
    expect(calls).toEqual([["Bearer private-one", undefined], ["Bearer private-one", "sess-1"], ["Bearer private-one", "sess-1"],
      ["Bearer private-two", undefined], ["Bearer private-two", "sess-2"], ["Bearer private-two", "sess-2"]]);
    expect(one.accounting.meta.connectionId).toBe("connection-one");
    expect(two.accounting.meta.connectionId).toBe("connection-two");
  });
});

describe("Z.AI result normalization", () => {
  it("unwraps double-encoded and direct arrays, rejecting other shapes", () => {
    expect(unwrapZaiContent(JSON.stringify(JSON.stringify([item])))).toEqual([item]);
    expect(unwrapZaiContent(JSON.stringify([item]))).toEqual([item]);
    for (const bad of ["not json", JSON.stringify({ results: [item] }), JSON.stringify("not json"), JSON.stringify(JSON.stringify({}))]) {
      expect(unwrapZaiContent(bad)).toBeNull();
    }
  });

  it("drops unsafe links, out-of-filter hosts and non-record items; sanitizes icons", () => {
    const params = { maxResults: 10, includes: ["example.com"] };
    const items = [item, null, "x", { ...item, link: "javascript:alert(1)" }, { ...item, link: "https://user:pw@example.com/" },
      { ...item, link: "https://evil.test/" }, { ...item, link: "https://sub.example.com/a", icon: "data:image/png;base64,AA", title: 7 }];
    const out = zaiSearchAdapter.normalize(toolText(items), params);
    expect(out.results.map((r) => r.url)).toEqual(["https://example.com/docs", "https://sub.example.com/a"]);
    expect(out.results[1]).toMatchObject({ favicon_url: null, title: "" });
    expect(out.totalResults).toBe(2);
    expect(zaiSearchAdapter.normalize({ content: [] }, params)).toEqual({ results: [], totalResults: null });
    expect(zaiSearchAdapter.normalize({ content: [{ type: "image", data: "x" }] }, params)).toEqual({ results: [], totalResults: null });
    expect(() => zaiSearchAdapter.normalize({ content: [{ type: "text", text: "oops" }] }, params)).toThrow();
    expect(() => zaiSearchAdapter.normalize({ isError: true, content: [{ type: "text", text: "boom" }] }, params)).toThrow(/tool error/);
  });

  it("drains SSE events across CRLF boundaries and flags malformed data", () => {
    const out = drainSseEvents(`id: 1\r\ndata: {"a":1}\r\n\r\ndata: {"b"`);
    expect(out.messages).toEqual([{ a: 1 }]);
    expect(out.rest).toBe(`data: {"b"`);
    expect(drainSseEvents("data: nope\n\n").malformed).toBe(true);
  });
});

describe("Z.AI pre-submit validation", () => {
  it.each([
    [{ query: "" }], [{ query: "a\u0000b" }], [{ query: "x".repeat(2001) }], [{ query: "q", search_type: "news" }],
    [{ query: "q", max_results: 0 }], [{ query: "q", max_results: 1.5 }], [{ query: "q", offset: 5 }], [{ query: "q", country: "us" }],
    [{ query: "q", language: "en" }], [{ query: "q", time_range: "day" }], [{ query: "q", content_options: { full: true } }],
    [{ query: "q", provider_options: { baseUrl: "http://127.0.0.1/mcp" } }], [{ query: "q", domain_filter: ["-example.com"] }],
    [{ query: "q", domain_filter: ["https://example.com/x"] }], [{ query: "q", domain_filter: "example.com" }], [{ query: "q", extra: 1 }],
  ])("rejects %j before any network call", async (body) => {
    const fetchImpl = server();
    const result = await search({ fetchImpl, body });
    expect(result.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("clamps max_results to the source maximum and defaults to 5", () => {
    expect(zaiSearchAdapter.validate({ query: "q", max_results: 500 }).maxResults).toBe(50);
    expect(zaiSearchAdapter.validate({ query: "q", provider: "glm", offset: 0, provider_options: {} })).toEqual({ query: "q", maxResults: 5, includes: [] });
  });

  it("refuses missing or header-unsafe credentials and invalid deadlines without network", async () => {
    const fetchImpl = server();
    expect((await search({ fetchImpl, credentials: null })).status).toBe(401);
    expect((await search({ fetchImpl, credentials: { apiKey: "bad key\n" } })).status).toBe(401);
    expect((await search({ fetchImpl, timeoutMs: 0 })).status).toBe(400);
    expect((await search({ fetchImpl, totalTimeoutMs: 60_001 })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Z.AI failures, quota and uncertain submission", () => {
  const noLeak = async (result) => {
    const text = JSON.stringify({ ...result, response: undefined }) + await result.response.clone().text();
    expect(text).not.toMatch(/private-one|upstream-secret/);
  };

  it.each([
    [401, {}, 401], [403, {}, 403], [402, {}, 402], [429, { error: { code: "1113" } }, 402], [403, { error: { code: "insufficient_quota" } }, 402],
  ])("maps initialize HTTP %i to %i without accepted job", async (status, body, expected) => {
    const fetchImpl = server({ initialize: () => json({ ...body, message: "upstream-secret private-one" }, status) });
    const result = await search({ fetchImpl });
    expect(result.status).toBe(expected);
    if (expected === 402) expect(result.quotaExhausted).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    expect(methods(fetchImpl)).toEqual(["initialize"]);
    await noLeak(result);
  });

  it("maps a tool-call 429 to rate-limit evidence and does not claim acceptance", async () => {
    const fetchImpl = server({ tool: () => json({ message: "slow" }, 429, { "retry-after": "30" }) });
    const result = await search({ fetchImpl });
    expect(result.status).toBe(429);
    expect(result.response.headers.get("retry-after")).toBe("30");
    expect(result.acceptedJob).toBeUndefined();
  });

  it("fails initialize protocol problems without reaching tools/call", async () => {
    for (const initialize of [
      () => json(rpc(0, { protocolVersion: "1999-01-01" })),
      () => json({ jsonrpc: "2.0", id: 0, error: { code: -32600, message: "upstream-secret" } }),
      () => initOk("bad session\u0001"),
      () => new Response("<html>", { headers: { "content-type": "text/html" } }),
      () => new Response(null, { status: 500 }),
    ]) {
      const fetchImpl = server({ initialize });
      const result = await search({ fetchImpl });
      expect(result.status).toBe(502);
      expect(result.acceptedJob).toBeUndefined();
      expect(methods(fetchImpl)).not.toContain("tools/call");
      await noLeak(result);
    }
    const notified = server({ initialized: () => new Response(null, { status: 400 }) });
    expect((await search({ fetchImpl: notified })).status).toBe(502);
    expect(methods(notified)).toEqual(["initialize", "notifications/initialized"]);
  });

  it("refuses redirects and foreign response origins on every step", async () => {
    const redirect = server({ initialize: () => new Response(null, { status: 307, headers: { location: "http://127.0.0.1/" } }) });
    expect((await search({ fetchImpl: redirect })).error).toMatch(/redirect refused/);
    expect(redirect).toHaveBeenCalledTimes(1);
    const foreign = server({ tool: () => { const r = json(rpc(1, toolText([item]))); Object.defineProperty(r, "url", { value: "https://evil.test/mcp" }); return r; } });
    const result = await search({ fetchImpl: foreign });
    expect(result.error).toMatch(/foreign response/);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "submit-unknown", connectionId: "connection-one" });
  });

  it.each([
    ["5xx", () => new Response("upstream-secret", { status: 503 }), "submit-unknown"],
    ["server-defined JSON-RPC error", () => json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "upstream-secret" } }), "tool-error"],
    ["tool isError", () => json(rpc(1, { isError: true, content: [{ type: "text", text: "upstream-secret" }] })), "tool-error"],
    ["malformed tool text", () => json(rpc(1, { content: [{ type: "text", text: "upstream-secret" }] })), "completed-unusable"],
    ["missing matching id", () => json(rpc(9, toolText([item]))), "completed-unread"],
    ["malformed SSE", () => new Response("data: {oops\n\n", { headers: { "content-type": "text/event-stream" } }), "completed-unread"],
  ])("reports %s after tools/call as an accepted job with no replay", async (_, tool, state) => {
    const fetchImpl = server({ tool });
    const result = await search({ fetchImpl });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ modality: "search", costStatus: "unknown", costSource: "accepted-job", meta: { jobState: state, connectionId: "connection-one" } });
    expect(methods(fetchImpl).filter((m) => m === "tools/call")).toHaveLength(1);
    await noLeak(result);
  });

  it("treats JSON-RPC protocol errors and session 404 on tools/call as definite refusals", async () => {
    const protocol = await search({ fetchImpl: server({ tool: () => json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } }) }) });
    expect(protocol.status).toBe(502);
    expect(protocol.acceptedJob).toBeUndefined();
    const expired = await search({ fetchImpl: server({ tool: () => new Response(null, { status: 404 }) }) });
    expect(expired.error).toMatch(/session rejected/);
    expect(expired.acceptedJob).toBeUndefined();
  });

  it("bounds oversized success bodies as unreadable accepted work", async () => {
    const big = `data: ${"x".repeat(2 * 1024 * 1024 + 10)}`;
    const result = await search({ fetchImpl: server({ tool: () => new Response(big, { headers: { "content-type": "text/event-stream" } }) }) });
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
  });

  it("does not claim acceptance when tools/call never left the gateway", async () => {
    const fetchImpl = server({ tool: () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } });
    const result = await search({ fetchImpl });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    const reset = await search({ fetchImpl: server({ tool: () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); } }) });
    expect(reset.acceptedJob.meta.jobState).toBe("submit-unknown");
  });
});

describe("Z.AI cancellation and deadlines", () => {
  const hang = (_msg, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));

  it("returns 499 without network for a pre-aborted signal", async () => {
    const fetchImpl = server();
    const controller = new AbortController();
    controller.abort();
    expect((await search({ fetchImpl, signal: controller.signal })).status).toBe(499);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts during initialize with 499 and no accepted job", async () => {
    const controller = new AbortController();
    const fetchImpl = server({ initialize: (msg, init) => { setTimeout(() => controller.abort(), 5); return hang(msg, init); } });
    const result = await search({ fetchImpl, signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("client abort during tools/call is an uncertain accepted job, never retried", async () => {
    const controller = new AbortController();
    const fetchImpl = server({ tool: (msg, init) => { setTimeout(() => controller.abort(), 5); return hang(msg, init); } });
    const result = await search({ fetchImpl, signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(methods(fetchImpl)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
  });

  it("enforces the per-step deadline as 504", async () => {
    const fetchImpl = server({ tool: hang });
    const result = await search({ fetchImpl, timeoutMs: 20 });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("enforces the total deadline across steps", async () => {
    const slow = (value) => () => new Promise((resolve) => setTimeout(() => resolve(value()), 30));
    const fetchImpl = server({ initialize: slow(() => initOk()), initialized: slow(() => new Response(null, { status: 202 })), tool: hang });
    const started = Date.now();
    const result = await search({ fetchImpl, timeoutMs: 1000, totalTimeoutMs: 80 });
    expect(result.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("aborts a stalled SSE body after the tool answered as completed-unread", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(": keepalive\n\n")); setTimeout(() => controller.abort(), 5); } });
    const fetchImpl = server({ tool: () => new Response(stream, { headers: { "content-type": "text/event-stream" } }) });
    const result = await search({ fetchImpl, signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
  });
});

// ── Staging state (registration promotes this block only) ──────────────
describe("staging registration state", () => {
  const registration = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-zai-search-search/registration.json", import.meta.url), "utf8"));

  it("is unregistered and describes the existing glm equivalent", () => {
    expect(registration.registered).toBe(false);
    expect(registration.canonicalId).toBe("zai-search");
    expect(registration.aliases).toEqual(["zai-search"]);
    expect(registration.credentialProviders).toEqual(["glm", "zai"]);
    expect(registration.localEquivalent.providerId).toBe("glm");
    expect(registration.endpoints.search).toBe(ZAI_SEARCH_MCP_URL);
    expect(glm.serviceKinds).toContain("webSearch");
  });
});
