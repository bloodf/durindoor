import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  searchConfig, firecrawlSearchMetadata, firecrawlSearchAdapter, FIRECRAWL_SEARCH_URL,
  handleFirecrawlSearchNative, normalizeFirecrawlSearch, buildFirecrawlSearchBody, estimatedSearchCostUsd, safePublicUrl,
} from "../../open-sse/services/providerParity/native-firecrawl-search/index.js";

const URL_ = "https://api.firecrawl.dev/v2/search";
const one = { id: "conn-one", apiKey: "fc-private-one" };
const two = { id: "conn-two", apiKey: "fc-private-two" };
const json = (v, status = 200, headers = {}) => Response.json(v, { status, headers });
const hit = (n, extra = {}) => ({ title: `T${n}`, url: `https://example.com/p${n}?q=1`, description: `D${n}`, ...extra });
const envelope = (web = [hit(1)], extra = {}) => ({ success: true, data: { web }, creditsUsed: 2, ...extra });
const search = (opts = {}) => handleFirecrawlSearchNative({ body: { query: "durin door" }, provider: { id: "firecrawl" }, credentials: one, ...opts });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Firecrawl native search protocol (independent of registration)", () => {
  it("pins the exact source registry fields", () => {
    expect(FIRECRAWL_SEARCH_URL).toBe(URL_);
    expect(searchConfig).toEqual({
      baseUrl: URL_, method: "POST", authType: "apikey", authHeader: "bearer", costPerQuery: 0.002, resultBlockSize: 10,
      freeMonthlyQuota: 1000, searchTypes: ["web", "news"], defaultMaxResults: 5, maxMaxResults: 100, timeoutMs: 30000, cacheTTLMs: 300000,
    });
    expect(firecrawlSearchMetadata.serviceKinds).toEqual(["webSearch"]);
    expect(Object.isFrozen(searchConfig) && Object.isFrozen(searchConfig.searchTypes)).toBe(true);
  });

  it("sends exact source headers/body and normalizes to the local unified result shape", async () => {
    const fetchImpl = vi.fn(async () => json(envelope([
      hit(1, { date: "2026-01-02", imageUrl: "https://img.example.com/a.png" }),
      { metadata: { title: "Meta", sourceURL: "https://www.meta.example.org/x", publishedTime: "2025" }, markdown: "m".repeat(400) },
      { link: "http://link.example.net/", snippet: "S", content: "ignored" },
    ])));
    const result = await search({ fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(URL_);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer fc-private-one" });
    expect(JSON.parse(init.body)).toEqual({ query: "durin door", limit: 5, sources: ["web"] });
    expect(result).toMatchObject({ success: true, status: 200 });
    const data = await result.response.json();
    expect(data).toEqual(result.data);
    expect(data).toMatchObject({ provider: "firecrawl", query: "durin door", answer: null, usage: { queries_used: 1, search_cost_usd: 0.002 }, errors: [] });
    expect(data.metrics.total_results_available).toBe(3);
    const [a, b, c] = data.results;
    expect(a).toMatchObject({
      title: "T1", url: "https://example.com/p1?q=1", display_url: "example.com/p1", snippet: "D1", position: 1, score: null,
      published_at: "2026-01-02", favicon_url: null, content: null, provider_raw: null,
      metadata: { author: null, language: null, source_type: null, image_url: "https://img.example.com/a.png" },
      citation: { provider: "firecrawl", rank: 1 },
    });
    expect(b).toMatchObject({ title: "Meta", url: "https://www.meta.example.org/x", display_url: "meta.example.org/x", snippet: "m".repeat(300), published_at: "2025", position: 2 });
    expect(c).toMatchObject({ title: "", url: "http://link.example.net/", snippet: "S", position: 3 });
    expect(result.accounting).toMatchObject({ modality: "search", cost: null, costStatus: "unknown",
      nativeUnits: { operations: 1, credits: 2 }, meta: { connectionId: "conn-one", nativeUnitsSource: "returned-result-blocks" } });
    expect(JSON.stringify(result.data)).not.toContain("fc-private");
  });

  it("maps news, country, language, time range and domain filters exactly as the source", async () => {
    const fetchImpl = vi.fn(async () => json({ success: true, data: { news: [hit(1)], web: [hit(9)] } }));
    const body = { query: "  gate\n\tstone ", search_type: "news", max_results: 20, country: "BR", language: "pt-BR",
      time_range: "week", domain_filter: ["Example.com", "-Spam.example.org"], offset: 0, provider_options: {} };
    const result = await search({ body, fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      query: "gate stone", limit: 20, sources: ["news"], country: "br", lang: "pt-BR", tbs: "qdr:w",
      includeDomains: ["example.com"], excludeDomains: ["spam.example.org"],
    });
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({ title: "T1", metadata: { source_type: "news" } });
    for (const [range, tbs] of [["day", "qdr:d"], ["month", "qdr:m"], ["year", "qdr:y"]]) {
      expect(buildFirecrawlSearchBody({ query: "q", time_range: range }).tbs).toBe(tbs);
    }
    expect(buildFirecrawlSearchBody({ query: "q", time_range: "any" })).toEqual({ query: "q", limit: 5, sources: ["web"] });
  });

  it("prices started 10-result blocks like the source computeSearchCostUsd", async () => {
    expect([0, 1, 10, 11, 100].map(estimatedSearchCostUsd)).toEqual([0.002, 0.002, 0.002, 0.004, 0.02]);
    const many = Array.from({ length: 30 }, (_, i) => hit(i));
    const result = await search({ body: { query: "q", max_results: 25 }, fetchImpl: async () => json(envelope(many, { creditsUsed: undefined })) });
    expect(result.data.results).toHaveLength(25);
    expect(result.data.usage.search_cost_usd).toBe(0.006);
    expect(result.accounting.nativeUnits).toEqual({ operations: 3 });
  });

  it("keeps two credentials isolated per call", async () => {
    const fetchImpl = vi.fn(async () => json(envelope()));
    const r1 = await search({ fetchImpl, credentials: one });
    const r2 = await search({ fetchImpl, credentials: two });
    expect(fetchImpl.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(["Bearer fc-private-one", "Bearer fc-private-two"]);
    expect([r1.accounting.meta.connectionId, r2.accounting.meta.connectionId]).toEqual(["conn-one", "conn-two"]);
    const tokenOnly = await search({ fetchImpl, credentials: { connectionId: "c3", accessToken: "tok-3" } });
    expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBe("Bearer tok-3");
    expect(tokenOnly.accounting.meta.connectionId).toBe("c3");
  });

  it("rejects unsupported or unsafe inputs before any billable submission", async () => {
    const fetchImpl = vi.fn();
    const bad = [
      { query: "" }, { query: "   " }, { query: "a\u0000b" }, { query: "x".repeat(2001) }, { query: 5 },
      { query: "q", search_type: "images" }, { query: "q", max_results: 0 }, { query: "q", max_results: 101 }, { query: "q", max_results: 2.5 },
      { query: "q", offset: 10 }, { query: "q", content_options: { full_text: true } },
      { query: "q", provider_options: { baseUrl: "http://127.0.0.1:3002" } }, { query: "q", time_range: "decade" },
      { query: "q", country: "usa" }, { query: "q", language: "pt_BR!" }, { query: "q", domain_filter: "example.com" },
      { query: "q", domain_filter: ["http://example.com/x"] }, { query: "q", domain_filter: Array(51).fill("a.com") },
      { query: "q", provider: "tavily" }, { query: "q", scrapeOptions: {} }, null,
    ];
    for (const body of bad) {
      const r = await search({ body, fetchImpl });
      expect(r).toMatchObject({ success: false, status: 400 });
      expect(r.acceptedJob).toBeUndefined();
    }
    expect(await search({ provider: "firecrawl_custom", fetchImpl })).toMatchObject({ status: 400 });
    expect(await search({ timeoutMs: 60_001, fetchImpl })).toMatchObject({ status: 400 });
    expect(await search({ timeoutMs: 0, fetchImpl })).toMatchObject({ status: 400 });
    for (const credentials of [null, {}, { apiKey: " " }, { apiKey: "bad key\n" }]) {
      expect(await search({ credentials, fetchImpl })).toMatchObject({ success: false, status: 401 });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps quota, rate limit and refusals without relaying upstream bodies", async () => {
    const leak = { error: "fc-private-one secret upstream detail", code: "insufficient_credits" };
    const quota = await search({ fetchImpl: async () => json(leak, 402) });
    expect(quota).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    const q403 = await search({ fetchImpl: async () => json({ error: { code: "insufficient_credits" } }, 403) });
    expect(q403).toMatchObject({ status: 402, quotaExhausted: true });
    const limited = await search({ fetchImpl: async () => json(leak, 429, { "retry-after": "7" }) });
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(limited.response.headers.get("Retry-After")).toBeTruthy();
    const unauthorized = await search({ fetchImpl: async () => json(leak, 401) });
    expect(unauthorized).toMatchObject({ status: 401 });
    for (const r of [quota, limited, unauthorized]) {
      expect(r.acceptedJob).toBeUndefined();
      const text = await r.response.text();
      expect(text).not.toContain("secret upstream");
      expect(text).not.toContain("fc-private");
    }
  });

  it("marks 5xx, unreadable and malformed outcomes as uncertain accepted work without replay", async () => {
    const cases = [
      [async () => json({ error: "boom fc-private-one" }, 503), "submit-unknown", 502],
      [async () => new Response("not json"), "completed-unusable", 502],
      [async () => json({ success: false, error: "x" }), "completed-unusable", 502],
      [async () => json({ success: true, data: [hit(1)] }), "completed-unusable", 502],
      [async () => json({ success: true, data: { web: "nope" } }), "completed-unusable", 502],
      [async () => { throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); }, "submit-unknown", 502],
    ];
    for (const [impl, state, status] of cases) {
      const fetchImpl = vi.fn(impl);
      const r = await search({ fetchImpl });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(r).toMatchObject({ success: false, status });
      expect(r.acceptedJob).toMatchObject({ cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: state, connectionId: "conn-one" } });
      expect(await r.response.text()).not.toContain("fc-private");
    }
    const notSent = await search({ fetchImpl: async () => { throw Object.assign(new Error("dns"), { code: "ENOTFOUND" }); } });
    expect(notSent).toMatchObject({ status: 502 });
    expect(notSent.acceptedJob).toBeUndefined();
  });

  it("refuses redirects and foreign-origin responses", async () => {
    const redirect = await search({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }) });
    expect(redirect).toMatchObject({ success: false, status: 502 });
    const foreign = new Response(JSON.stringify(envelope()), { headers: { "content-type": "application/json" } });
    Object.defineProperty(foreign, "url", { value: "https://evil.example.com/v2/search" });
    const r = await search({ fetchImpl: async () => foreign });
    expect(r).toMatchObject({ success: false, status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
  });

  it("honors caller abort before and during submission, and the per-call deadline", async () => {
    const pre = new AbortController(); pre.abort();
    const fetchImpl = vi.fn();
    expect(await search({ signal: pre.signal, fetchImpl })).toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();

    const ctl = new AbortController();
    let seen;
    const hanging = vi.fn((_u, init) => { seen = init.signal; return new Promise(() => {}); });
    const pending = search({ signal: ctl.signal, fetchImpl: hanging });
    await vi.waitFor(() => expect(hanging).toHaveBeenCalled());
    ctl.abort();
    const aborted = await pending;
    expect(aborted).toMatchObject({ success: false, status: 499, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(seen.aborted).toBe(true);

    vi.useFakeTimers();
    const late = search({ timeoutMs: 50, fetchImpl: vi.fn(() => new Promise(() => {})) });
    await vi.advanceTimersByTimeAsync(60);
    expect(await late).toMatchObject({ success: false, status: 504, acceptedJob: { meta: { jobState: "submit-unknown" } } });
  });

  it("drops unsafe result links and image URLs instead of publishing them", async () => {
    const raw = envelope([
      hit(1, { url: "http://127.0.0.1/admin" }), hit(2, { url: "javascript:alert(1)" }), hit(3, { url: "https://user:pw@example.com/" }),
      hit(4, { url: "http://169.254.169.254/latest" }), hit(5, { url: "http://[::1]/" }), "junk",
      hit(6, { imageUrl: "http://10.0.0.1/x.png", title: "ok\u0007 title" }),
    ]);
    const result = await search({ fetchImpl: async () => json(raw) });
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({ title: "ok title", url: "https://example.com/p6?q=1", position: 1, metadata: { image_url: null } });
    expect(result.data.errors).toEqual([{ code: "unsafe_result_dropped", count: 6 }]);
    expect(safePublicUrl("https://localhost/x")).toBeNull();
    expect(normalizeFirecrawlSearch({ success: true, data: {} }, buildFirecrawlSearchBody({ query: "q" })).results).toEqual([]);
    expect(firecrawlSearchAdapter.buildUrl()).toBe(URL_);
  });
});

describe("Firecrawl search staging state (isolated; promoted at serial registration)", () => {
  it("records the unregistered staging contract", () => {
    const reg = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-firecrawl-search/registration.json", import.meta.url), "utf8"));
    expect(reg).toMatchObject({ registered: false, canonicalId: "firecrawl", aliases: ["firecrawl"], serviceKinds: ["webSearch"],
      source: { repository: "OmniRoute", commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad" },
      endpoints: { search: URL_ }, auth: { authType: "apikey", authHeader: "bearer" } });
  });

  it("is not yet wired into the shared firecrawl provider definition", async () => {
    const { default: firecrawl } = await import("../../open-sse/providers/registry/firecrawl.js");
    expect(firecrawl.searchConfig).toBeUndefined();
    expect(firecrawl.serviceKinds).toEqual(["webFetch"]);
    expect(firecrawl.fetchConfig.baseUrl).toBe("https://api.firecrawl.dev/v2/scrape");
  });
});
