import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  searchConfig, xquikSearchProviderDefinition, xquikSearchMetadata, xquikSearchAdapter, xquikValidationProbe,
  XQUIK_SEARCH_ALIASES, buildXquikSearchParams, buildXquikSearchUrl, normalizeXquikSearchResponse,
  resolveXquikSearchProviderId, handleXquikSearchNative,
} from "../../open-sse/services/providerParity/native-xquik-search/index.js";
import { resolveCredentialProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";

const BASE = "https://xquik.com/api/v1/x/tweets/search";
const credentials = { id: "connection-one", apiKey: "xq_private_one" };
const second = { id: "connection-two", apiKey: "xq_private_two" };
const NOW = "2026-11-27T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const json = (v, status = 200, headers = {}) => Response.json(v, { status, headers });
// Fixture copied from the pinned source test (tests/unit/xquik-search-provider.test.ts).
const payload = () => ({
  tweets: [
    {
      id: "1912345678901234567", text: "Agents SDK update", createdAt: "2026-08-24T07:00:00.000Z",
      author: { username: "openai", name: "OpenAI" },
    },
  ],
  has_next_page: false,
  next_cursor: "",
});
const search = (opts = {}) => handleXquikSearchNative({ body: { query: "agents sdk" }, credentials, now: NOW, nowMs: NOW_MS, ...opts });
const urlOf = (fetchImpl, i = 0) => new URL(fetchImpl.mock.calls[i][0]);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Xquik Search native protocol (independent of registration)", () => {
  it("pins exact source registry endpoint/auth/limits and catalog metadata", () => {
    expect(searchConfig).toMatchObject({
      baseUrl: BASE, method: "GET", authType: "apikey", authHeader: "x-api-key", costPerQuery: 0.00075,
      freeMonthlyQuota: 0, searchTypes: ["x"], defaultMaxResults: 5, maxMaxResults: 20, timeoutMs: 15_000,
      cacheTTLMs: 300_000, fallbackOnly: true, fixedBaseUrl: true, preventRedirects: true,
    });
    expect(xquikSearchProviderDefinition).toMatchObject({ id: "xquik-search", alias: "xquik", category: "apikey", serviceKinds: ["webSearch"], searchConfig });
    expect(xquikSearchProviderDefinition.display).toMatchObject({ name: "Xquik X Search", textIcon: "XQ", color: "#111827", website: "https://docs.xquik.com" });
    expect(xquikSearchMetadata.serviceKinds).toEqual(["webSearch"]);
    expect(xquikValidationProbe).toMatchObject({ url: `${BASE}?q=test&limit=1`, method: "GET", billable: true });
    expect(Object.isFrozen(searchConfig) && Object.isFrozen(searchConfig.searchTypes)).toBe(true);
  });

  it("resolves the source aliases without touching other X providers", () => {
    expect(XQUIK_SEARCH_ALIASES).toEqual(["xquik", "xquik_search"]);
    for (const id of ["xquik-search", "xquik", "xquik_search"]) expect(resolveXquikSearchProviderId(id)).toBe("xquik-search");
    for (const id of ["x-search", "x_search", "xai", "grok"]) expect(resolveXquikSearchProviderId(id)).toBeNull();
  });

  it("sends the exact source GET contract over a fixed origin with redirects refused", async () => {
    const fetchImpl = vi.fn(async () => json(payload()));
    const result = await search({ body: { query: '  from:openai "agents sdk" ', max_results: 3, provider: "xquik" }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init, proxy] = fetchImpl.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://xquik.com");
    expect(parsed.pathname).toBe("/api/v1/x/tweets/search");
    expect([...parsed.searchParams.entries()]).toEqual([["q", 'from:openai "agents sdk"'], ["queryType", "Latest"], ["limit", "3"]]);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ Accept: "application/json", "x-api-key": "xq_private_one" });
    expect(proxy).toEqual(resolveCredentialProxyOptions(credentials));
    expect(result.success).toBe(true);
  });

  it("maps queryType, time_range sinceTime, default/clamped limit and accessToken fallback", () => {
    expect(buildXquikSearchParams({ query: "q" }, credentials, NOW_MS)).toEqual({ q: "q", queryType: "Latest", limit: 5 });
    expect(buildXquikSearchParams({ query: "q", max_results: 99 }, credentials, NOW_MS).limit).toBe(20);
    expect(buildXquikSearchParams({ query: "q", provider_options: { queryType: "Top" } }, credentials, NOW_MS).queryType).toBe("Top");
    expect(buildXquikSearchParams({ query: "q" }, { ...credentials, providerSpecificData: { queryType: "Top" } }, NOW_MS).queryType).toBe("Top");
    expect(buildXquikSearchParams({ query: "q", provider_options: { queryType: "Latest" } }, { providerSpecificData: { queryType: "Top" } }, NOW_MS).queryType).toBe("Latest");
    const expected = { hour: "2026-11-26T23:00:00.000Z", day: "2026-11-26T00:00:00.000Z", week: "2026-11-20T00:00:00.000Z", month: "2026-10-28T00:00:00.000Z", year: "2025-11-27T00:00:00.000Z" };
    for (const [range, since] of Object.entries(expected)) {
      const params = buildXquikSearchParams({ query: "q", time_range: range }, credentials, NOW_MS);
      expect(params.sinceTime).toBe(since);
      expect(new URL(buildXquikSearchUrl(params)).searchParams.get("sinceTime")).toBe(since);
    }
    expect(xquikSearchAdapter.buildHeaders({ accessToken: "tok" })).toEqual({ Accept: "application/json", "x-api-key": "tok" });
  });

  it("canonicalizes search_type web to x as the source route does", async () => {
    const fetchImpl = vi.fn(async () => json(payload()));
    for (const search_type of ["x", "web", undefined]) {
      expect((await search({ body: { query: "q", search_type }, fetchImpl })).success).toBe(true);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("normalizes source tweets into canonical X citations with honest usage/accounting", async () => {
    const result = await search({ fetchImpl: async () => json(payload()) });
    expect(result).toMatchObject({ success: true, status: 200 });
    const data = await result.response.json();
    expect(data).toEqual(result.data);
    expect(data).toMatchObject({ provider: "xquik-search", query: "agents sdk", answer: null, errors: [], usage: { queries_used: 1, search_cost_usd: 0.00075 } });
    expect(data.metrics.total_results_available).toBe(1);
    expect(data.results).toEqual([{
      title: "@openai", url: "https://x.com/openai/status/1912345678901234567", display_url: "x.com/openai/status/1912345678901234567",
      snippet: "Agents SDK update", position: 1, score: null, published_at: "2026-08-24T07:00:00.000Z", favicon_url: null, content: null,
      metadata: { author: "openai", language: null, source_type: "x", image_url: null },
      citation: { provider: "xquik-search", retrieved_at: NOW, rank: 1 }, provider_raw: null,
    }]);
    expect(JSON.stringify(data)).not.toContain("next_cursor");
    expect(JSON.stringify(data)).not.toContain("xq_private_one");
    expect(result.accounting).toMatchObject({ modality: "search", cost: null, costStatus: "unknown", meta: { connectionId: "connection-one", registryCostPerQueryUsd: 0.00075, returnedPosts: 1, queryType: "Latest" } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("drops rows failing the source schema, never trusts upstream URLs, and caps to the limit", () => {
    const rows = [
      { id: "not-a-tweet-id", text: "Invalid rows must not become links", author: { username: "attacker" } },
      { id: "1", text: "bad handle", author: { username: "../evil" } },
      { id: "2", text: "bad handle 2", author: { username: "a".repeat(16) } },
      { id: "3", text: 42 }, { id: 4, text: "numeric id" }, { id: "5", text: "x", createdAt: 7 }, { id: "6", text: "x", author: "string" },
      { id: "7".repeat(26), text: "too long id" }, { id: "8", text: "x".repeat(100_001) }, { id: "9", text: "bell\u0007" },
      "string-row", null,
      { id: "10", text: "no author", url: "http://127.0.0.1/admin", createdAt: "<script>" },
      { id: "11", text: "multi\nline", author: { username: "dev_rel" } },
      { id: "12", text: "over limit" },
    ];
    const out = normalizeXquikSearchResponse({ tweets: rows }, 2, NOW);
    expect(out.results.map((r) => [r.title, r.url, r.published_at, r.metadata.author])).toEqual([
      ["X post", "https://x.com/i/status/10", null, null],
      ["@dev_rel", "https://x.com/dev_rel/status/11", null, "dev_rel"],
    ]);
    expect(out.totalResults).toBe(2);
    expect(normalizeXquikSearchResponse({ tweets: [] }, 5, NOW)).toEqual({ results: [], totalResults: 0 });
  });

  it("treats malformed success bodies as possibly-billed, unusable work without relaying them", async () => {
    for (const body of ["not json", JSON.stringify([]), JSON.stringify({}), JSON.stringify({ tweets: "x" }), JSON.stringify({ error: "xq_private_one leaked" }), JSON.stringify({ tweets: Array(1001).fill({}) })]) {
      const result = await search({ fetchImpl: async () => new Response(body, { status: 200 }) });
      expect(result).toMatchObject({ success: false, status: 502, error: "Invalid Xquik Search response" });
      expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "completed-unusable", connectionId: "connection-one" } });
      expect(await result.response.text()).not.toContain("xq_private_one");
    }
  });
});

describe("Xquik Search failures, quota and credentials", () => {
  it("maps a bare 401 to a credential failure without echoing the key", async () => {
    const result = await search({ credentials: { apiKey: "xq_bad" }, fetchImpl: async () => new Response(null, { status: 401 }) });
    expect(result).toMatchObject({ success: false, status: 401, error: "Xquik Search credential refused" });
    expect(result.acceptedJob).toBeUndefined();
    expect(await result.response.text()).not.toContain("xq_bad");
  });

  it("never relays upstream error bodies", async () => {
    const result = await search({ fetchImpl: async () => json({ error: "leak xq_private_one at /srv/app.js:1" }, 400) });
    expect(result).toMatchObject({ success: false, status: 400, error: "Xquik Search request refused" });
    const text = await result.response.text();
    expect(text).not.toContain("leak");
    expect(text).not.toContain("xq_private_one");
  });

  it("flags quota exhaustion for 402 and credit error codes", async () => {
    for (const [status, body] of [[402, {}], [429, { error: { code: "insufficient_credits" } }], [403, { error: "no_credits" }]]) {
      const result = await search({ fetchImpl: async () => json(body, status) });
      expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
      expect(result.acceptedJob).toBeUndefined();
    }
  });

  it("keeps rate limits distinct from quota and carries retry-after evidence", async () => {
    const result = await search({ fetchImpl: async () => json({ error: "rate_limited" }, 429, { "retry-after": "7" }) });
    expect(result).toMatchObject({ success: false, status: 429 });
    expect(result.quotaExhausted).toBeUndefined();
    expect(result.response.headers.get("Retry-After")).toBeTruthy();
  });

  it("marks 5xx as uncertain accepted work without retrying", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "x" }, 503));
    const result = await search({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
  });

  it("isolates two credentials: each request carries only its own key, settings and connection id", async () => {
    const fetchImpl = vi.fn(async () => json(payload()));
    const topSecond = { ...second, providerSpecificData: { queryType: "Top" } };
    const [a, b] = await Promise.all([search({ fetchImpl }), search({ credentials: topSecond, fetchImpl })]);
    const calls = fetchImpl.mock.calls.map(([url, init]) => [init.headers["x-api-key"], new URL(url).searchParams.get("queryType")]).sort();
    expect(calls).toEqual([["xq_private_one", "Latest"], ["xq_private_two", "Top"]]);
    expect(a.accounting.meta.connectionId).toBe("connection-one");
    expect(b.accounting.meta.connectionId).toBe("connection-two");
    for (const [, init, proxy] of fetchImpl.mock.calls) {
      expect(Object.keys(init.headers)).toEqual(["Accept", "x-api-key"]);
      const owner = init.headers["x-api-key"] === "xq_private_two" ? topSecond : credentials;
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
      { query: "q", language: "en" }, { query: "q", time_range: "decade" }, { query: "q", offset: 5 }, { query: "q", cursor: "abc" },
      { query: "q", provider_options: { baseUrl: "http://127.0.0.1" } }, { query: "q", provider_options: { queryType: "Media" } },
      { query: "q", provider_options: "Top" }, { query: "q", content_options: {} }, { query: "q", stream: true },
      { query: "q", provider: "x-search" }, { query: "q", max_results: 0 }, { query: "q", max_results: 1.5 }, { query: "q", max_results: "5" },
      { query: "   " }, { query: "bad\u0007q" }, { query: 1 }, { query: "x".repeat(2001) }, null, [],
    ];
    for (const body of bodies) {
      const fetchImpl = vi.fn();
      const result = await search({ body, fetchImpl });
      expect(result).toMatchObject({ success: false, status: 400, error: "Unsupported Xquik Search request" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});

describe("Xquik Search cancellation, deadlines and no replay", () => {
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

  it("enforces the total deadline across a stalled connect and a stalled body read", async () => {
    const hung = vi.fn((_url, init) => new Promise(() => { void init; }));
    expect(await search({ timeoutMs: 30, fetchImpl: hung })).toMatchObject({ success: false, status: 504, acceptedJob: { meta: { jobState: "submit-unknown" } } });
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
    expect(await search({ fetchImpl: redirect })).toMatchObject({ success: false, status: 502, error: "Xquik Search redirect refused" });
    expect(redirect).toHaveBeenCalledTimes(1);
    const foreign = json(payload());
    Object.defineProperty(foreign, "url", { value: "https://evil.example/api/v1/x/tweets/search" });
    expect(await search({ fetchImpl: async () => foreign })).toMatchObject({ success: false, status: 502, error: "Xquik Search foreign response refused" });
  });

  it("keeps caller input inside the query string of the fixed URL", async () => {
    const fetchImpl = vi.fn(async () => json(payload()));
    await search({ body: { query: "@evil.example/#?x=1&limit=999" }, fetchImpl });
    const url = urlOf(fetchImpl);
    expect(url.origin + url.pathname).toBe(BASE);
    expect(url.searchParams.get("q")).toBe("@evil.example/#?x=1&limit=999");
    expect(url.searchParams.getAll("limit")).toEqual(["5"]);
  });
});

// --- Staging block: the only assertions that depend on unregistered state. ---
// Serial registration may promote this block to strict positive identity assertions.
describe("Xquik Search staging state (unregistered)", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const dir = "open-sse/services/providerParity/native-xquik-search";

  it("declares itself unregistered with the exact canonical id, aliases and endpoints", () => {
    const reg = JSON.parse(readFileSync(join(root, dir, "registration.json"), "utf8"));
    expect(reg).toMatchObject({
      registered: false, canonicalId: "xquik-search", aliases: ["xquik", "xquik_search"], sourceAliases: ["xquik", "xquik_search"],
      serviceKinds: ["webSearch"], searchTypes: ["x"], fallbackOnly: true,
      auth: { authType: "apikey", authHeader: "x-api-key" }, endpoints: { discovery: null },
      source: { repository: "OmniRoute", commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad" },
    });
    expect(reg.endpoints.search.startsWith(`GET ${BASE}`)).toBe(true);
    expect(Object.keys(reg.exports)).toEqual(["config.js", "adapter.js", "service.js", "index.js"]);
  });

  it("is not imported by production code and no production registry has an xquik entry", () => {
    const hits = [];
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (name === "node_modules" || p.includes("providerParity/native-xquik-search")) continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(c?m?js|ts|json)$/.test(name) && /native-xquik-search|xquik/i.test(readFileSync(p, "utf8"))) hits.push(relative(root, p));
      }
    };
    walk(join(root, "open-sse")); walk(join(root, "src"));
    expect(hits).toEqual([]);
  });
});
