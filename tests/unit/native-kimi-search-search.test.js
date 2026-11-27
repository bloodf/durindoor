import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  searchConfig, kimiSearchProviderDefinition, kimiSearchMetadata, kimiSearchAdapter,
  KIMI_SEARCH_SOURCE_ALIASES, KIMI_SEARCH_ALIASES,
  buildKimiSearchBody, normalizeKimiSearchResponse, resolveKimiSearchProviderId, safeResultUrl,
  handleKimiSearchNative,
} from "../../open-sse/services/providerParity/native-kimi-search-search/index.js";
import { resolveCredentialProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";

const URL_ = "https://api.moonshot.ai/v1/tools/search";
const credentials = { id: "connection-one", apiKey: "private-one" };
const second = { id: "connection-two", apiKey: "private-two" };
const NOW = "2026-11-27T00:00:00.000Z";
const json = (v, status = 200, headers = {}) => Response.json(v, { status, headers });
// Fixture copied from the pinned source test (tests/unit/search-kimi-provider.test.ts).
const payload = () => ({
  search_results: [
    {
      title: "Kimi K2 model release", url: "https://www.moonshot.ai/news/kimi-k2",
      snippet: "Moonshot AI announces Kimi K2.", text: "Full page content for the Kimi K2 release announcement.",
      date: "2026-06-01", site_name: "Moonshot AI", authority: "S", icon: "https://platform.kimi.ai/favicon.ico", mime: "text/html",
    },
    {
      title: "Kimi docs", url: "https://platform.kimi.ai/docs/api/tools-search", snippet: "", text: "",
      date: "2026-05-20", site_name: "Kimi API Open Platform", authority: "S", icon: "https://platform.kimi.ai/favicon.ico", mime: "text/html",
    },
  ],
});
const search = (opts = {}) => handleKimiSearchNative({ body: { query: "kimi k2" }, credentials, now: NOW, ...opts });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Kimi Search native protocol (independent of registration)", () => {
  it("pins exact source registry endpoint/auth/limits and catalog metadata", () => {
    expect(searchConfig).toMatchObject({
      baseUrl: URL_, method: "POST", authType: "apikey", authHeader: "bearer", costPerQuery: 0.005,
      freeMonthlyQuota: 0, searchTypes: ["web"], defaultMaxResults: 5, maxMaxResults: 20, timeoutMs: 10_000, cacheTTLMs: 300_000,
      fixedBaseUrl: true, preventRedirects: true,
    });
    expect(kimiSearchProviderDefinition).toMatchObject({ id: "kimi-search", alias: "kimi-search", category: "apikey", serviceKinds: ["webSearch"], searchConfig });
    expect(kimiSearchProviderDefinition.display).toMatchObject({ name: "Kimi Search", textIcon: "KM", website: "https://platform.kimi.ai/docs/api/tools-search" });
    expect(kimiSearchMetadata.serviceKinds).toEqual(["webSearch"]);
    expect(Object.isFrozen(searchConfig) && Object.isFrozen(searchConfig.searchTypes)).toBe(true);
    expect(kimiSearchAdapter.buildUrl()).toBe(URL_);
  });

  it("resolves the source aliases but only registers the non-colliding one", () => {
    expect(KIMI_SEARCH_SOURCE_ALIASES).toEqual(["kimi", "moonshot"]);
    expect(KIMI_SEARCH_ALIASES).toEqual(["moonshot"]);
    for (const id of ["kimi-search", "kimi", "moonshot"]) expect(resolveKimiSearchProviderId(id)).toBe("kimi-search");
    expect(resolveKimiSearchProviderId("kimi-web")).toBeNull();
  });

  it("sends exact source headers/body over a fixed origin with redirects refused", async () => {
    const fetchImpl = vi.fn(async () => json(payload()));
    const result = await search({ body: { query: "  kimi   k2   release  ", max_results: 5, search_type: "web", provider: "moonshot" }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init, proxy] = fetchImpl.mock.calls[0];
    expect(url).toBe(URL_);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer private-one" });
    expect(JSON.parse(init.body)).toEqual({ text_query: "kimi k2 release", limit: 5, include_content: true });
    expect(proxy).toEqual(resolveCredentialProxyOptions(credentials));
    expect(result.success).toBe(true);
  });

  it("defaults limit to 5, clamps to 20 and falls back to accessToken", () => {
    expect(buildKimiSearchBody({ query: "q" })).toEqual({ text_query: "q", limit: 5, include_content: true });
    expect(buildKimiSearchBody({ query: "q", max_results: 99 }).limit).toBe(20);
    expect(kimiSearchAdapter.buildHeaders({ accessToken: "tok" })).toEqual({ "Content-Type": "application/json", Authorization: "Bearer tok" });
  });

  it("normalizes source results into the local SearchResult shape with honest usage/accounting", async () => {
    const result = await search({ fetchImpl: async () => json(payload()) });
    expect(result).toMatchObject({ success: true, status: 200 });
    const data = await result.response.json();
    expect(data).toEqual(result.data);
    expect(data).toMatchObject({ provider: "kimi-search", query: "kimi k2", answer: null, errors: [], usage: { queries_used: 1, search_cost_usd: 0.005 } });
    expect(data.metrics.total_results_available).toBe(2);
    const [first, secondRow] = data.results;
    expect(first).toEqual({
      title: "Kimi K2 model release", url: "https://www.moonshot.ai/news/kimi-k2", display_url: "moonshot.ai/news/kimi-k2",
      snippet: "Moonshot AI announces Kimi K2.", position: 1, score: null, published_at: "2026-06-01", favicon_url: null,
      content: { format: "text", text: "Full page content for the Kimi K2 release announcement.", length: 55 },
      metadata: { author: null, language: null, source_type: null, image_url: null },
      citation: { provider: "kimi-search", retrieved_at: NOW, rank: 1 }, provider_raw: null,
    });
    expect(secondRow).toMatchObject({ snippet: "", content: null, position: 2 });
    expect(JSON.stringify(data)).not.toContain("site_name");
    expect(result.accounting).toMatchObject({ modality: "search", cost: null, costStatus: "unknown", meta: { connectionId: "connection-one", registryCostPerQueryUsd: 0.005, nonEmpty: true } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("reports zero list price for an empty result set", async () => {
    const result = await search({ fetchImpl: async () => json({ search_results: [] }) });
    expect(result.success).toBe(true);
    expect(result.data.results).toEqual([]);
    expect(result.data.usage).toEqual({ queries_used: 1, search_cost_usd: 0 });
    expect(result.data.metrics.total_results_available).toBe(0);
  });

  it("drops unsafe result URLs, non-object rows and caps to the requested limit", () => {
    const rows = [
      { url: "javascript:alert(1)", title: "x" }, { url: "http://127.0.0.1/admin" }, { url: "http://169.254.169.254/latest" },
      { url: "https://user:pw@example.com/" }, { url: "file:///etc/passwd" }, { url: "http://[::1]/" }, "string-row", null,
      { url: "https://a.example/1", title: 42, snippet: { x: 1 }, text: ["no"], date: "<script>" },
      { url: "https://b.example/2" }, { url: "https://c.example/3" },
    ];
    const out = normalizeKimiSearchResponse({ search_results: rows }, 2, NOW);
    expect(out.results.map((r) => r.url)).toEqual(["https://a.example/1", "https://b.example/2"]);
    expect(out.results[0]).toMatchObject({ title: "", snippet: "", content: null, published_at: null });
    expect(out.totalResults).toBe(2);
    expect(safeResultUrl("https://localhost/")).toBeNull();
    expect(safeResultUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
  });

  it("treats malformed success bodies as possibly-billed, unusable work without relaying them", async () => {
    for (const body of ["not json", JSON.stringify([]), JSON.stringify({}), JSON.stringify({ search_results: "x" }), JSON.stringify({ error: { message: "private-one" } })]) {
      const result = await search({ fetchImpl: async () => new Response(body, { status: 200 }) });
      expect(result).toMatchObject({ success: false, status: 502, error: "Invalid Kimi Search response" });
      expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "completed-unusable", connectionId: "connection-one" } });
      expect(await result.response.text()).not.toContain("private-one");
    }
  });
});

describe("Kimi Search failures, quota and credentials", () => {
  it("maps a bare 401 to a credential failure without echoing the key", async () => {
    const result = await search({ credentials: { apiKey: "bad-key" }, fetchImpl: async () => new Response(null, { status: 401 }) });
    expect(result).toMatchObject({ success: false, status: 401, error: "Kimi Search credential refused" });
    expect(result.acceptedJob).toBeUndefined();
    expect(await result.response.text()).not.toContain("bad-key");
  });

  it("never relays upstream error bodies", async () => {
    const result = await search({ fetchImpl: async () => json({ error: { message: "leak private-one at /srv/app.js:1", type: "invalid_request_error" } }, 400) });
    expect(result).toMatchObject({ success: false, status: 400, error: "Kimi Search request refused" });
    const text = await result.response.text();
    expect(text).not.toContain("leak");
    expect(text).not.toContain("private-one");
  });

  it("flags quota exhaustion for 402 and documented quota error types", async () => {
    for (const [status, type] of [[402, undefined], [429, "exceeded_current_quota_error"], [403, "insufficient_balance"]]) {
      const result = await search({ fetchImpl: async () => json(type ? { error: { type, message: "m" } } : {}, status) });
      expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
      expect(result.acceptedJob).toBeUndefined();
    }
  });

  it("keeps rate limits distinct from quota and carries retry-after evidence", async () => {
    const result = await search({ fetchImpl: async () => json({ error: { type: "rate_limit_reached_error" } }, 429, { "retry-after": "7" }) });
    expect(result).toMatchObject({ success: false, status: 429 });
    expect(result.quotaExhausted).toBeUndefined();
    expect(result.response.headers.get("Retry-After")).toBeTruthy();
  });

  it("marks 5xx as uncertain accepted work without retrying", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { message: "x" } }, 503));
    const result = await search({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
  });

  it("isolates two credentials: each request carries only its own key and connection id", async () => {
    const fetchImpl = vi.fn(async () => json(payload()));
    const [a, b] = await Promise.all([search({ fetchImpl }), search({ credentials: second, fetchImpl })]);
    const auths = fetchImpl.mock.calls.map(([, init]) => init.headers.Authorization).sort();
    expect(auths).toEqual(["Bearer private-one", "Bearer private-two"]);
    expect(a.accounting.meta.connectionId).toBe("connection-one");
    expect(b.accounting.meta.connectionId).toBe("connection-two");
    for (const [, init, proxy] of fetchImpl.mock.calls) {
      const owner = init.headers.Authorization === "Bearer private-two" ? second : credentials;
      expect(proxy).toEqual(resolveCredentialProxyOptions(owner));
    }
  });

  it("refuses missing or unsafe credentials before calling out", async () => {
    for (const creds of [{}, null, { apiKey: "  " }, { apiKey: "bad key\n" }]) {
      const fetchImpl = vi.fn();
      const result = await search({ credentials: creds, fetchImpl });
      expect(result).toMatchObject({ success: false, status: 401 });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("rejects unsupported inputs before billable submission", async () => {
    const bodies = [
      { query: "q", search_type: "news" }, { query: "q", domain_filter: ["a.com"] }, { query: "q", country: "us" },
      { query: "q", time_range: "day" }, { query: "q", offset: 5 }, { query: "q", provider_options: { baseUrl: "http://127.0.0.1" } },
      { query: "q", content_options: {} }, { query: "q", stream: true }, { query: "q", provider: "brave-search" },
      { query: "q", max_results: 0 }, { query: "q", max_results: 1.5 }, { query: "q", max_results: "5" },
      { query: "   " }, { query: "bad\u0007q" }, { query: 1 }, { query: "x".repeat(2001) }, null, [],
    ];
    for (const body of bodies) {
      const fetchImpl = vi.fn();
      const result = await search({ body, fetchImpl });
      expect(result).toMatchObject({ success: false, status: 400, error: "Unsupported Kimi Search request" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});

describe("Kimi Search cancellation, deadlines and no replay", () => {
  it("does not send when already aborted or the deadline is invalid", async () => {
    const fetchImpl = vi.fn();
    const ctrl = new AbortController(); ctrl.abort();
    expect(await search({ signal: ctrl.signal, fetchImpl })).toMatchObject({ success: false, status: 499 });
    for (const timeoutMs of [0, -1, Number.NaN, 15_001]) expect(await search({ timeoutMs, fetchImpl })).toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts an in-flight socket on caller cancel and records uncertain work", async () => {
    const ctrl = new AbortController();
    let seen;
    const fetchImpl = vi.fn((_url, init) => { seen = init.signal; return new Promise(() => {}); });
    const pending = search({ signal: ctrl.signal, fetchImpl });
    await Promise.resolve(); await Promise.resolve();
    ctrl.abort();
    const result = await pending;
    expect(seen.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 499, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces the total deadline across a stalled body read", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200 });
    const result = await search({ timeoutMs: 30, fetchImpl: async () => stalled });
    expect(result).toMatchObject({ success: false, status: 504, acceptedJob: { meta: { jobState: "completed-unread" } } });
  });

  it("never replays an uncertain submit, but does not bill a pre-connect DNS failure", async () => {
    const reset = vi.fn(async () => { throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); });
    const r1 = await search({ fetchImpl: reset });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(r1).toMatchObject({ success: false, status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    const dns = vi.fn(async () => { throw Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }); });
    const r2 = await search({ fetchImpl: dns });
    expect(dns).toHaveBeenCalledTimes(1);
    expect(r2).toMatchObject({ success: false, status: 502 });
    expect(r2.acceptedJob).toBeUndefined();
    expect(r2.error).not.toContain("getaddrinfo");
  });

  it("refuses redirects and foreign-origin responses without following them", async () => {
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/steal" } }));
    expect(await search({ fetchImpl: redirect })).toMatchObject({ success: false, status: 502, error: "Kimi Search redirect refused" });
    expect(redirect).toHaveBeenCalledTimes(1);
    const foreign = json(payload());
    Object.defineProperty(foreign, "url", { value: "https://evil.example/v1/tools/search" });
    expect(await search({ fetchImpl: async () => foreign })).toMatchObject({ success: false, status: 502, error: "Kimi Search foreign response refused" });
  });
});

// --- Staging block: the only assertions that depend on unregistered state. ---
// Serial registration may promote this block to strict positive identity assertions.
describe("Kimi Search staging state (unregistered)", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const dir = "open-sse/services/providerParity/native-kimi-search-search";

  it("declares itself unregistered with the exact canonical id, aliases and endpoints", () => {
    const reg = JSON.parse(readFileSync(join(root, dir, "registration.json"), "utf8"));
    expect(reg).toMatchObject({
      registered: false, canonicalId: "kimi-search", aliases: ["moonshot"], sourceAliases: ["kimi", "moonshot"],
      serviceKinds: ["webSearch"], endpoints: { search: `POST ${URL_}`, discovery: null },
      source: { repository: "OmniRoute", commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad" },
    });
    expect(Object.keys(reg.exports)).toEqual(["config.js", "adapter.js", "service.js", "index.js"]);
  });

  it("is not imported by production code and no production registry has a kimi-search entry", () => {
    const hits = [];
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (name === "node_modules" || p.includes("providerParity/native-kimi-search-search")) continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(c?m?js|ts|json)$/.test(name) && /native-kimi-search-search|["']kimi-search["']/.test(readFileSync(p, "utf8"))) hits.push(relative(root, p));
      }
    };
    walk(join(root, "open-sse")); walk(join(root, "src"));
    expect(hits).toEqual([]);
  });
});
