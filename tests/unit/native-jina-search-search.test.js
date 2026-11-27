import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  searchConfig, searchModels, jinaSearchProviderDefinition, JINA_SEARCH_URL, JINA_SEARCH_REQUEST_ALIASES,
  JINA_SEARCH_CREDENTIAL_FALLBACKS, jinaSearchAdapter, safeResultUrl, sanitizeJinaQuery,
  handleJinaSearchNative, listJinaSearchModels,
} from "../../open-sse/services/providerParity/native-jina-search-search/index.js";

const credentials = { id: "connection-one", apiKey: "private-one" };
const item = (n, extra = {}) => ({
  title: `Title ${n}`, url: `https://example.com/page-${n}?ref=x`, description: `desc ${n}`, content: `# body ${n}`, ...extra,
});
const jinaOk = { code: 200, status: 20000, data: [item(1), item(2)], meta: { usage: { tokens: 4321 } } };
const json = (v, status = 200, headers = {}) => Response.json(v, { status, headers });
const body = { query: "  latest   rust release ", max_results: 3, search_type: "web" };
const search = (opts = {}) => handleJinaSearchNative({ body, credentials, ...opts });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Jina Search native protocol (independent of registration)", () => {
  it("pins exact source registry fields, aliases and credential fallback", () => {
    expect(searchConfig).toEqual({
      id: "jina-search", name: "Jina Search (s.jina.ai)", baseUrl: "https://s.jina.ai", method: "POST",
      authType: "apikey", authHeader: "bearer", costPerQuery: 0.002, freeMonthlyQuota: 1000,
      searchTypes: ["web"], defaultMaxResults: 5, maxMaxResults: 50, timeoutMs: 15000, cacheTTLMs: 300000,
    });
    expect(JINA_SEARCH_URL).toBe("https://s.jina.ai/");
    expect(JINA_SEARCH_REQUEST_ALIASES).toEqual(["jina-ai", "jina"]);
    expect(JINA_SEARCH_CREDENTIAL_FALLBACKS).toEqual(["jina-ai"]);
    expect(searchModels).toEqual([{ id: "jina-search", name: "Jina Search (s.jina.ai)", kind: "webSearch" }]);
    expect(jinaSearchProviderDefinition).toMatchObject({ id: "jina-search", authType: "apikey", serviceKinds: ["webSearch"], searchConfig });
    expect(Object.isFrozen(searchConfig) && Object.isFrozen(searchModels[0])).toBe(true);
  });

  it("sends exact source headers/body to the fixed origin and rebuilds results", async () => {
    const fetchImpl = vi.fn(async () => json(jinaOk));
    const result = await search({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://s.jina.ai/");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer private-one" });
    expect(JSON.parse(init.body)).toEqual({ q: "latest rust release", num: 3 });
    expect(result).toMatchObject({ success: true, status: 200 });
    const out = await result.response.json();
    expect(out).toMatchObject({
      provider: "jina-search", query: "latest rust release", answer: null,
      usage: { queries_used: 1, search_cost_usd: 0.002 }, errors: [],
      metrics: { total_results_available: 2 },
    });
    expect(out.results[0]).toEqual({
      title: "Title 1", url: "https://example.com/page-1?ref=x", display_url: "example.com/page-1", snippet: "desc 1",
      position: 1, score: null, published_at: null, favicon_url: null,
      content: { format: "markdown", text: "# body 1", length: 8 },
      metadata: { author: null, language: null, source_type: null, image_url: null },
      citation: { provider: "jina-search", retrieved_at: expect.any(String), rank: 1 }, provider_raw: null,
    });
    expect(out.results[1].position).toBe(2);
    expect(result.data).toEqual(out);
  });

  it("maps locale/offset like the source and clamps num to maxMaxResults", () => {
    expect(jinaSearchAdapter.buildBody({ query: "q", country: "br", language: "pt-BR", offset: 2, max_results: 500 }))
      .toEqual({ q: "q", num: 50, gl: "BR", hl: "pt-BR", page: 2 });
    expect(jinaSearchAdapter.buildBody({ query: "q", offset: 0 })).toEqual({ q: "q", num: 5 });
    expect(jinaSearchAdapter.buildBody({ query: "q", provider: "jina", model: "jina-search/search", time_range: "any", domain_filter: [], provider_options: {} }))
      .toEqual({ q: "q", num: 5 });
    expect(jinaSearchAdapter.buildUrl()).toBe("https://s.jina.ai/");
  });

  it.each([
    {}, { query: "" }, { query: "   " }, { query: 1 }, { query: "a\u0001b" }, { query: "x".repeat(501) },
    { query: "q", search_type: "news" }, { query: "q", time_range: "day" }, { query: "q", domain_filter: ["a.com"] },
    { query: "q", content_options: { full_page: true } }, { query: "q", provider_options: { foo: 1 } },
    { query: "q", max_results: 0 }, { query: "q", max_results: 2.5 }, { query: "q", max_results: "5" },
    { query: "q", offset: -1 }, { query: "q", offset: 101 }, { query: "q", country: "BRA" }, { query: "q", language: "x" },
    { query: "q", provider: "brave-search" }, { query: "q", stream: true }, { query: "q", extra: "field" }, null,
  ])("refuses unsupported input %j before any billable submit", async (input) => {
    const fetchImpl = vi.fn();
    const result = await handleJinaSearchNative({ body: input, credentials, fetchImpl });
    expect(result.status).toBe(400);
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes the query like the local sanitizer", () => {
    expect(sanitizeJinaQuery("ｑｕｅｒｙ\t two")).toBe("query two");
  });

  it.each([[{ apiKey: "" }], [{}], [null], [{ apiKey: "bad key" }], [{ apiKey: "bad\nkey" }]])("requires a clean key %j without network", async (creds) => {
    const fetchImpl = vi.fn();
    expect((await search({ credentials: creds, fetchImpl })).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps two credentials isolated and records the selected connection identity", async () => {
    const fetchImpl = vi.fn(async () => json(jinaOk));
    const one = await search({ fetchImpl });
    const two = await search({ fetchImpl, credentials: { connectionId: "connection-two", accessToken: "private-two" } });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer private-one");
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer private-two");
    expect(one.accounting.meta.connectionId).toBe("connection-one");
    expect(two.accounting.meta.connectionId).toBe("connection-two");
    expect(JSON.stringify(await two.response.json())).not.toContain("private");
  });

  it("prefers apiKey over accessToken as the source token resolution does", async () => {
    const fetchImpl = vi.fn(async () => json(jinaOk));
    await search({ fetchImpl, credentials: { apiKey: "key-a", accessToken: "token-b" } });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer key-a");
  });

  it("records Jina tokens as native units and keeps cost unknown", async () => {
    const result = await search({ fetchImpl: async () => json(jinaOk) });
    expect(result.accounting).toMatchObject({
      modality: "search", cost: null, costStatus: "unknown", tokens: {},
      nativeUnits: { jina_tokens: 4321 }, meta: { nativeUnitsSource: "meta.usage.tokens", connectionId: "connection-one" },
    });
    const bare = await search({ fetchImpl: async () => json([item(1)]) });
    expect(bare.accounting.nativeUnits).toEqual({});
    expect(bare.accounting.costStatus).toBe("unknown");
  });

  it.each([[[item(1)]], [{ results: [item(1)] }], [{ data: [item(1)] }]])("accepts the source item envelopes %j", (raw) => {
    expect(jinaSearchAdapter.normalize(raw, 5).results.map((r) => r.url)).toEqual(["https://example.com/page-1?ref=x"]);
  });

  it("uses snippet/text fallbacks and caps results at num", () => {
    const out = jinaSearchAdapter.normalize([{ url: "https://a.example/", snippet: "s", text: "t" }, item(2), item(3)], 2);
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toMatchObject({ title: "", snippet: "s", content: { format: "markdown", text: "t", length: 1 } });
    expect(jinaSearchAdapter.normalize({ code: 200, data: null }, 5).results).toEqual([]);
  });

  it("drops unsafe result URLs and strips control bytes from text", async () => {
    const raw = { data: [
      item(1, { title: "ok\u0000\u001b[31m" }),
      item(2, { url: "http://127.0.0.1/admin" }), item(3, { url: "http://169.254.169.254/latest" }),
      item(4, { url: "javascript:alert(1)" }), item(5, { url: "https://user:pass@example.com/" }),
      item(6, { url: "file:///etc/passwd" }), item(7, { url: 42 }), "not-an-item", item(8, { url: "http://localhost/" }),
    ] };
    const result = await search({ fetchImpl: async () => json(raw) });
    const out = await result.response.json();
    expect(out.results.map((r) => r.url)).toEqual(["https://example.com/page-1?ref=x"]);
    expect(out.results[0].title).toBe("ok[31m");
    expect(out.errors).toEqual([{ code: "unsafe_results_dropped", count: 8 }]);
    expect(safeResultUrl("https://[::1]/")).toBeNull();
    expect(safeResultUrl("https://example.com/a b")).toBeNull();
  });

  it.each([{ code: 200 }, { data: "x" }, "plain", 7, { error: "boom" }])("treats malformed success %j as completed-unusable accepted work", async (raw) => {
    const result = await search({ fetchImpl: async () => json(raw) });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", meta: { jobState: "completed-unusable", connectionId: "connection-one" } });
    expect(JSON.stringify(await result.response.json())).not.toMatch(/boom|plain/);
  });

  it("treats unparsable success bodies as completed-unusable", async () => {
    const result = await search({ fetchImpl: async () => new Response("<html>private-one</html>", { status: 200 }) });
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unusable");
    expect(JSON.stringify(await result.response.json())).not.toContain("private-one");
  });

  it("maps Jina 402 InsufficientBalanceError to connection quota exhaustion without relaying the body", async () => {
    const result = await search({ fetchImpl: async () => json({ code: 402, name: "InsufficientBalanceError", readableMessage: "private-one balance" }, 402) });
    expect(result).toMatchObject({ status: 402, quotaExhausted: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(JSON.stringify(await result.response.json())).not.toContain("private-one");
    const tagged = await search({ fetchImpl: async () => json({ name: "InsufficientBalanceError" }, 403) });
    expect(tagged).toMatchObject({ status: 402, quotaExhausted: true });
  });

  it("refuses auth failures and surfaces rate-limit evidence", async () => {
    const auth = await search({ fetchImpl: async () => json({ code: 401, name: "AuthenticationRequiredError", message: "private-one" }, 401) });
    expect(auth.status).toBe(401);
    expect(auth.error).toBe("Jina Search credentials refused");
    const limited = await search({ fetchImpl: async () => json({ name: "RateLimitTriggeredError" }, 429, { "retry-after": "30" }) });
    expect(limited.status).toBe(429);
    expect(limited.quotaExhausted).toBeUndefined();
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(limited.response.headers.get("Retry-After")).toBeTruthy();
    const unprocessable = await search({ fetchImpl: async () => json({ message: "private-one" }, 422) });
    expect(unprocessable.status).toBe(422);
    expect(unprocessable.acceptedJob).toBeUndefined();
  });

  it("marks 5xx as uncertain accepted work and never replays", async () => {
    const fetchImpl = vi.fn(async () => json({ message: "private-one" }, 503));
    const result = await search({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "submit-unknown", connectionId: "connection-one" } });
    expect(JSON.stringify(await result.response.json())).not.toContain("private-one");
  });

  it("marks a socket reset after send as uncertain and does not retry", async () => {
    const fetchImpl = vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); });
    const result = await search({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("does not claim accepted work when the connection was never established", async () => {
    const result = await search({ fetchImpl: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); } });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("refuses redirects and foreign response origins", async () => {
    const redirect = await search({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }) });
    expect(redirect.status).toBe(502);
    expect(redirect.error).toBe("Jina Search redirect refused");
    const foreign = json(jinaOk);
    Object.defineProperty(foreign, "url", { value: "https://evil.example/" });
    const moved = await search({ fetchImpl: async () => foreign });
    expect(moved.status).toBe(502);
    expect(moved.error).toBe("Jina Search foreign response refused");
  });

  it("refuses oversized success bodies", async () => {
    const huge = JSON.stringify({ data: [item(1, { content: "x".repeat(9 * 1024 * 1024) })] });
    const result = await search({ fetchImpl: async () => new Response(huge, { status: 200 }) });
    expect(result.status).toBe(502);
    expect(result.success).toBe(false);
  });

  it("aborts the socket on caller cancellation", async () => {
    const controller = new AbortController();
    let seen;
    const fetchImpl = vi.fn((_url, init) => { seen = init.signal; return new Promise(() => {}); });
    const pending = search({ fetchImpl, signal: controller.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    controller.abort();
    const result = await pending;
    expect(result.status).toBe(499);
    expect(seen.aborted).toBe(true);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("returns 499 without network for an already-aborted signal", async () => {
    const fetchImpl = vi.fn();
    const result = await search({ fetchImpl, signal: AbortSignal.abort() });
    expect(result.status).toBe(499);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces the per-call deadline and aborts the request", async () => {
    let seen;
    const result = await search({ timeoutMs: 5, fetchImpl: (_u, init) => { seen = init.signal; return new Promise(() => {}); } });
    expect(result.status).toBe(504);
    expect(seen.aborted).toBe(true);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("bounds the per-call deadline by the absolute total deadline", async () => {
    const fetchImpl = vi.fn();
    expect((await search({ fetchImpl, deadlineAt: Date.now() - 1 })).status).toBe(504);
    expect(fetchImpl).not.toHaveBeenCalled();
    const start = Date.now();
    const result = await search({ timeoutMs: 60_000, deadlineAt: start + 10, fetchImpl: () => new Promise(() => {}) });
    expect(result.status).toBe(504);
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it.each([0, -1, 60_001, Number.NaN])("rejects invalid deadline %s without network", async (timeoutMs) => {
    const fetchImpl = vi.fn();
    expect((await search({ fetchImpl, timeoutMs })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times out a stalled body read after headers arrive", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200 });
    const result = await search({ timeoutMs: 20, fetchImpl: async () => stalled });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
  });

  it("lists the static source catalog without network (no dynamic discovery in source)", () => {
    expect(listJinaSearchModels()).toEqual({ success: true, models: [{ id: "jina-search", serviceKinds: ["webSearch"] }] });
  });
});

describe("existing local dispatch gap evidence", () => {
  it("generic dedicated search would send a non-Jina envelope and normalize nothing", async () => {
    const { buildSearchRequest } = await import("../../open-sse/handlers/search/callers.js");
    const { normalizeSearchResponse } = await import("../../open-sse/handlers/search/normalizers.js");
    const { init } = buildSearchRequest({ id: "jina-search", baseUrl: "https://s.jina.ai", method: "POST" }, { query: "q", maxResults: 5, searchType: "web", token: "t" });
    expect(JSON.parse(init.body)).toEqual({ query: "q", max_results: 5, search_type: "web" });
    expect(normalizeSearchResponse("jina-search", jinaOk, "q", "web").results).toEqual([]);
  });
  it("local `jina` alias names the jina-ai embedding provider, which has no search capability", async () => {
    const { default: jinaAi } = await import("../../open-sse/providers/registry/jina-ai.js");
    expect(jinaAi.alias).toBe("jina");
    expect(jinaAi.searchConfig).toBeUndefined();
    expect(jinaAi.serviceKinds).not.toContain("webSearch");
  });
});

// ISOLATED STAGING BLOCK: registration can replace only these assertions.
describe("private staging registration", () => {
  it("remains unregistered: no jina-search provider or search builder exists yet", async () => {
    const registry = await import("../../open-sse/providers/registry/index.js");
    const all = Object.values(registry).flatMap((v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []));
    expect(all.some((p) => p?.id === "jina-ai")).toBe(true);
    expect(all.some((p) => p?.id === "jina-search")).toBe(false);
    const metadata = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-jina-search-search/registration.json", import.meta.url), "utf8"));
    expect(metadata).toMatchObject({
      registered: false, canonicalId: "jina-search", aliases: ["jina-search"], requestOnlyAliases: ["jina-ai", "jina"],
      credentialFallbacks: ["jina-ai"], serviceKinds: ["webSearch"], models: { webSearch: ["jina-search"] },
    });
    expect(metadata.endpoints).toEqual({ search: "https://s.jina.ai/", discovery: null });
  });
});
