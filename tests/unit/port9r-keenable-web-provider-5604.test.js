/**
 * Keenable keyless web search/fetch (upstream 9router #5604 port, #1072).
 *
 * Offline only: every request goes to a stubbed global fetch. No real provider
 * is contacted, no credential is used, and nothing here exercises a transport
 * bypass. Fixtures mirror the documented public-tier shapes of the official
 * keenable-sdk (POST /v1/search/public, GET /v1/fetch/public).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { NOAUTH_PROVIDERS } from "../../open-sse/config/providers.js";
import { FREE_NO_AUTH_PROVIDER_IDS } from "../../src/shared/constants/freeNoAuthProviders.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({}))
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/keyAccess.js", () => ({ getKeyAccessContext: vi.fn(), filterModelsListForKey: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn() }));

const provider = REGISTRY.find((entry) => entry.id === "keenable");
const SEARCH_URL = "https://api.keenable.ai/v1/search/public";
const FETCH_URL = "https://api.keenable.ai/v1/fetch/public";
const page = "https://example.com/article";
const FIXTURE_TOKEN = "fixture-not-a-real-credential";

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json" }
});
const searchConfig = { id: "keenable", ...provider.searchConfig };
const baseParams = { query: "sqlite wal", searchType: "web", maxResults: 3 };

// A fetch that never answers until its signal aborts, like a stalled upstream.
const hangingFetch = () => vi.fn((_url, init) => new Promise((_resolve, reject) => {
  init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("registration", () => {
  it("is a keyless explicit-selection provider on fixed official HTTPS origins", () => {
    expect(provider).toMatchObject({ noAuth: true, authType: "none", category: "freeTier" });
    expect(provider.serviceKinds).toEqual(["webSearch", "webFetch"]);
    expect(provider.searchConfig.baseUrl).toBe(SEARCH_URL);
    expect(provider.fetchConfig.baseUrl).toBe(FETCH_URL);
    expect(provider.searchConfig.preventRedirects).toBe(true);
    expect(provider.fetchConfig.preventRedirects).toBe(true);
    expect(provider.fetchConfig.formats).toEqual(["markdown"]);
  });

  it("is not seeded into any automatic no-auth pool", () => {
    expect(NOAUTH_PROVIDERS.keenable).toBeUndefined();
    expect(FREE_NO_AUTH_PROVIDER_IDS).not.toContain("keenable");
    expect(provider.autoComboNoAuth).toBeUndefined();
  });

  it("is not discoverable on /v1/models/web without an explicit connection", async () => {
    vi.doMock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn() }));
    const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
    db.getProviderConnections.mockResolvedValue([{ id: 1, provider: "openai", isActive: true }]);
    const ids = (await buildModelsList(["webSearch", "webFetch"])).map((model) => model.id);
    expect(ids).not.toContain("keenable/search");
    expect(ids).not.toContain("keenable/fetch");
  });
});

describe("search request mapping", () => {
  it("builds a keyless POST with only documented public-tier fields", () => {
    vi.useFakeTimers({ now: new Date("2026-11-20T12:00:00Z") });
    const request = buildSearchRequest(searchConfig, {
      ...baseParams,
      domainFilter: ["SQLite.org", "-Example.org"],
      timeRange: "week",
      token: FIXTURE_TOKEN,
      providerOptions: { baseUrl: "https://203.0.113.9/collect", mode: "realtime", objective: "x" },
      providerSpecificData: { baseUrl: "https://198.51.100.7/collect" }
    });
    expect(request.url).toBe(SEARCH_URL);
    expect(request.init.method).toBe("POST");
    expect(request.init.headers["X-Keenable-Title"]).toBe("durindoor");
    expect(JSON.stringify(request)).not.toContain(FIXTURE_TOKEN);
    expect(Object.keys(request.init.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(Object.keys(request.init.headers).map((k) => k.toLowerCase())).not.toContain("x-api-key");
    expect(JSON.parse(request.init.body)).toEqual({
      query: "sqlite wal",
      max_results: 3,
      site: "sqlite.org",
      exclude_domains: ["example.org"],
      published_after: "2026-11-13"
    });
  });

  it.each([
    ["day", "2026-11-19"],
    ["month", "2026-10-20"],
    ["year", "2025-11-20"]
  ])("maps time_range %s to a YYYY-MM-DD published_after", (timeRange, expected) => {
    vi.useFakeTimers({ now: new Date("2026-11-20T12:00:00Z") });
    const body = JSON.parse(buildSearchRequest(searchConfig, { ...baseParams, timeRange }).init.body);
    expect(body.published_after).toBe(expected);
  });

  it("sends no date filter for time_range any or none", () => {
    for (const timeRange of [undefined, "any"]) {
      const body = JSON.parse(buildSearchRequest(searchConfig, { ...baseParams, timeRange }).init.body);
      expect(body).toEqual({ query: "sqlite wal", max_results: 3 });
    }
  });

  it("rejects filters it cannot honor instead of dropping them", () => {
    const build = (extra) => () => buildSearchRequest(searchConfig, { ...baseParams, ...extra });
    expect(build({ domainFilter: ["a.com", "*.b.com"] })).toThrow("hosts only");
    expect(build({ offset: 5 })).toThrow("does not support offset");
    expect(build({ searchType: "news" })).toThrow("Unsupported Keenable search type");
    expect(build({ timeRange: "decade" })).toThrow("Unsupported Keenable time_range");
    expect(build({ maxResults: 51 })).toThrow("max_results");
    expect(build({ domainFilter: ["https://a.com/path"] })).toThrow("hosts only");
    expect(build({ domainFilter: ["-*.a.com"] })).toThrow("hosts only");
    expect(build({ domainFilter: [42] })).toThrow("list of strings");
  });
});

describe("search response mapping", () => {
  it("normalizes results and tolerates malformed payloads", () => {
    const normalized = normalizeSearchResponse("keenable", {
      results: [
        { title: "Write-Ahead Logging", url: "https://sqlite.org/wal.html", description: "", snippet: "WAL is faster", published_at: "2026-01-02" },
        { title: "No snippet", url: page, description: "Fallback text" },
        null,
        { title: 7, url: ["x"], snippet: {} }
      ]
    }, "sqlite wal", "web");
    expect(normalized.totalResults).toBe(2);
    expect(normalized.results[0]).toMatchObject({ title: "Write-Ahead Logging", url: "https://sqlite.org/wal.html", snippet: "WAL is faster", published_at: "2026-01-02", position: 1 });
    expect(normalized.results[1].snippet).toBe("Fallback text");
    expect(normalized.results.map((result) => result.url)).toEqual(["https://sqlite.org/wal.html", page]);
    expect(normalizeSearchResponse("keenable", {}, "q", "web")).toEqual({ results: [], totalResults: 0 });
  });
});

describe("handleSearchCore with a stubbed transport", () => {
  const run = (config = provider.searchConfig, body = {}) => handleSearchCore({
    body: { query: "sqlite wal", max_results: 2, ...body },
    provider: { id: "keenable" },
    providerConfig: config,
    credentials: null
  });

  it("calls the fixed endpoint keylessly and maps the response", async () => {
    const fetchMock = vi.fn(async () => json({
      results: [
        { title: "A", url: "https://a.example/", snippet: "sa" },
        { title: "B", url: "https://b.example/", description: "db" },
        { title: "C", url: "https://c.example/", snippet: "sc" }
      ]
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await run(provider.searchConfig, { provider_options: { baseUrl: "https://203.0.113.9/x" } });
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(SEARCH_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ query: "sqlite wal", max_results: 2 });
    expect(result.data.provider).toBe("keenable");
    expect(result.data.results.map((r) => r.snippet)).toEqual(["sa", "db"]);
    expect(result.data.usage.search_cost_usd).toBe(0);
  });

  it.each(["not a url", "https://example.com/search"])(
    "ignores caller and stored destinations including %s",
    async (baseUrl) => {
      const fetchMock = vi.fn(async () => json({ results: [] }));
      vi.stubGlobal("fetch", fetchMock);
      const result = await handleSearchCore({
        body: { query: "sqlite wal", provider_options: { baseUrl } },
        provider: { id: "keenable" },
        providerConfig: provider.searchConfig,
        credentials: { apiKey: FIXTURE_TOKEN, providerSpecificData: { baseUrl } }
      });
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(SEARCH_URL);
      expect(init.redirect).toBe("manual");
      expect(JSON.stringify(init.headers)).not.toContain(FIXTURE_TOKEN);
    }
  );

  it("ignores an invalid caller destination without a stored override", async () => {
    const fetchMock = vi.fn(async () => json({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await run(provider.searchConfig, { provider_options: { baseUrl: "not a url" } })).success).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe(SEARCH_URL);
  });

  it("does not follow a redirect and does not fall back to any other provider", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://203.0.113.99/collect" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(SEARCH_URL);
  });

  it("keeps upstream error status so combo fallback can decide", async () => {
    const fetchMock = vi.fn(async () => json({ message: "Rate limit exceeded" }, 429));
    vi.stubGlobal("fetch", fetchMock);
    const result = await run();
    expect(result).toMatchObject({ success: false, status: 429 });
    expect(result.error).toContain("Rate limit exceeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a stalled upstream as a 504 after aborting the request", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const result = await run({ ...provider.searchConfig, timeoutMs: 20 });
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("reports a transport failure as a 502 and refuses an unsupported filter before any request", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("socket closed"); });
    vi.stubGlobal("fetch", fetchMock);
    expect(await run()).toMatchObject({ success: false, status: 502 });
    fetchMock.mockClear();
    const refused = await run(provider.searchConfig, { offset: 10 });
    expect(refused).toMatchObject({ success: false, status: 400 });
    expect(refused.error).toContain("does not support offset");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleFetchCore with a stubbed transport", () => {
  const run = (extra = {}) => handleFetchCore({ url: page, provider: "keenable", providerConfig: provider.fetchConfig, ...extra });

  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("fetches keylessly from the fixed endpoint and maps the page", async () => {
    const fetchMock = vi.fn(async () => json({
      url: page, title: "Article", content: "# Article\n\nBody", truncated: false, total_chars: 16,
      author: "Ann", published_at: "2026-01-02"
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await run({ maxCharacters: 5000, credentials: { apiKey: FIXTURE_TOKEN, token: FIXTURE_TOKEN } });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      provider: "keenable",
      title: "Article",
      content: { format: "markdown", text: "# Article\n\nBody" },
      metadata: { author: "Ann", published_at: "2026-01-02" },
      usage: { fetch_cost_usd: 0 }
    });
    const [url, init] = fetchMock.mock.calls[0];
    const called = new URL(url);
    expect(called.origin + called.pathname).toBe(FETCH_URL);
    expect([...called.searchParams.keys()].sort()).toEqual(["max_chars", "url"]);
    expect(called.searchParams.get("url")).toBe(page);
    expect(called.searchParams.get("max_chars")).toBe("5000");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.headers["X-Keenable-Title"]).toBe("durindoor");
    expect(JSON.stringify(init)).not.toContain(FIXTURE_TOKEN);
    expect(JSON.stringify([...called.searchParams])).not.toContain(FIXTURE_TOKEN);
  });

  it("omits max_chars when none is requested", async () => {
    const fetchMock = vi.fn(async () => json({ content: "text" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await run();
    expect(result.success).toBe(true);
    expect(result.data.metadata).toEqual({ author: null, published_at: null, language: null });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has("max_chars")).toBe(false);
  });

  it("surfaces upstream errors with their status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "Rate limit exceeded" }, 429)));
    expect(await run()).toMatchObject({ success: false, status: 429, error: "Rate limit exceeded" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503, headers: { "content-type": "text/plain" } })));
    expect(await run()).toMatchObject({ success: false, status: 503, error: "upstream down" });
  });

  it("does not follow a redirect", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://203.0.113.99/collect" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await run();
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.error).toContain("redirects are not followed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unusable body and unsupported options before or without trusting them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ title: "no content" })));
    expect(await run()).toMatchObject({ success: false, status: 502 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await run({ format: "html" })).toMatchObject({ success: false, status: 400 });
    expect(await run({ maxCharacters: 1.5 })).toMatchObject({ success: false, status: 400 });
    expect(await run({ maxCharacters: -3 })).toMatchObject({ success: false, status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the existing outbound URL policy for the page being fetched", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await run({ url: "http://127.0.0.1/admin" });
    expect(result.success).toBe(false);
    expect([400, 403]).toContain(result.status);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a stalled upstream and reports 504", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const result = await run({ providerConfig: { ...provider.fetchConfig, timeoutMs: 20 } });
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("truncates on code-point boundaries without touching other providers' truncation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ content: "A😀" })));
    expect((await run({ maxCharacters: 2 })).data.content.text).toBe("A😀");
    const cut = await run({ maxCharacters: 1 });
    expect(cut.data.content.text).toBe("A");
    expect(cut.data.content.text).not.toMatch(/[\uD800-\uDFFF]/);
  });
});
