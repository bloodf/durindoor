import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  DDG_FREE_ID, DDG_FREE_ALIASES, DDG_LITE_URL, DDG_USER_AGENT, searchConfig, duckduckgoFreeProviderDefinition,
  duckduckgoSearchAdapter, parseSearchParams, parseDuckDuckGoLite, resolveResultUrl, isAnomalyPage,
  handleDuckDuckGoFreeSearchNative, discoverDuckDuckGoFreeModels,
} from "../../open-sse/services/providerParity/native-duckduckgo-search-search/index.js";

// Real lite shape (pinned OmniRoute tests/unit/free-web-search.test.ts fixture).
const LITE_HTML = `
<table>
  <tr><td valign="top">1.&nbsp;</td><td>
    <a rel="nofollow" href="https://platform.claude.com/docs/en/api/overview" class='result-link'>API overview - <b>Claude</b> API Docs - Anthropic</a>
  </td></tr>
  <tr><td>&nbsp;&nbsp;&nbsp;</td><td class='result-snippet'><b>Claude</b> <b>API</b> Documentation. New to Claude?</td></tr>
  <tr><td valign="top">2.&nbsp;</td><td>
    <a rel="nofollow" href="https://www.anthropic.com/api" class='result-link'>Claude Platform | Claude - Anthropic</a>
  </td></tr>
  <tr><td>&nbsp;&nbsp;&nbsp;</td><td class='result-snippet'>Build with the most capable models.</td></tr>
</table>`;
const html = (text, status = 200, headers = {}) =>
  new Response(text, { status, headers: { "content-type": "text/html; charset=UTF-8", ...headers } });
const one = { id: "row-one", connectionId: "conn-one", apiKey: "secret-one" };
const two = { id: "row-two", connectionId: "conn-two", apiKey: "secret-two", providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-two.test:8080" } };
const search = (opts = {}) => handleDuckDuckGoFreeSearchNative({ body: { query: "claude api" }, credentials: one, ...opts });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("DuckDuckGo free search protocol (independent of registration)", () => {
  it("pins the exact source registry fields, alias and provider definition", () => {
    expect(DDG_FREE_ID).toBe("duckduckgo-free");
    expect(DDG_FREE_ALIASES).toEqual(["duckduckgo"]);
    expect(searchConfig).toEqual({
      id: "duckduckgo-free", name: "DuckDuckGo (free)", baseUrl: "https://lite.duckduckgo.com/lite/", method: "POST",
      authType: "none", authHeader: "none", costPerQuery: 0, freeMonthlyQuota: 999999, searchTypes: ["web"],
      defaultMaxResults: 5, maxMaxResults: 25, timeoutMs: 10000, cacheTTLMs: 300000, fallbackOnly: true,
    });
    expect(duckduckgoFreeProviderDefinition).toMatchObject({ id: "duckduckgo-free", alias: "duckduckgo", authType: "none", noAuth: true, serviceKinds: ["webSearch"] });
    const { id: _i, name: _n, ...rest } = searchConfig;
    expect(duckduckgoFreeProviderDefinition.searchConfig).toEqual(rest);
    expect(Object.isFrozen(searchConfig) && Object.isFrozen(duckduckgoFreeProviderDefinition.searchConfig)).toBe(true);
    expect(discoverDuckDuckGoFreeModels()).toEqual({ success: true, models: [], discovery: "none" });
  });

  it("sends exact source URL/method/headers/form body and never a credential", async () => {
    const fetchImpl = vi.fn(async () => html(LITE_HTML));
    const result = await search({ fetchImpl, body: { query: "  claude\t api  ", max_results: 5, search_type: "web", provider: "duckduckgo-free" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(DDG_LITE_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded", "User-Agent": DDG_USER_AGENT, Accept: "text/html" });
    expect(init.body).toBe("q=claude+api");
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("secret-one");
    expect(result).toMatchObject({ success: true, status: 200 });
  });

  it("normalizes lite HTML into the unified search envelope", async () => {
    const result = await search({ fetchImpl: async () => html(LITE_HTML) });
    const body = await result.response.json();
    expect(body).toEqual(result.data);
    expect(body).toMatchObject({ provider: "duckduckgo-free", query: "claude api", answer: null, usage: { queries_used: 1, search_cost_usd: 0 }, errors: [] });
    expect(body.metrics.total_results_available).toBe(2);
    expect(body.results.map((r) => [r.position, r.url, r.title])).toEqual([
      [1, "https://platform.claude.com/docs/en/api/overview", "API overview - Claude API Docs - Anthropic"],
      [2, "https://www.anthropic.com/api", "Claude Platform | Claude - Anthropic"],
    ]);
    expect(body.results[0]).toMatchObject({
      display_url: "platform.claude.com/docs/en/api/overview", snippet: "Claude API Documentation. New to Claude?",
      score: null, content: null, provider_raw: null, citation: { provider: "duckduckgo-free", rank: 1 },
    });
    expect(result.response.headers.get("content-type")).toBe("application/json");
  });

  it("caps results to max_results and clamps to maxMaxResults", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `<a href="https://e${i}.example.com/" class='result-link'>T${i}</a><td class='result-snippet'>s${i}</td>`).join("");
    const capped = await search({ fetchImpl: async () => html(many), body: { query: "q", max_results: 1 } });
    expect(capped.data.results).toHaveLength(1);
    const dflt = await search({ fetchImpl: async () => html(many) });
    expect(dflt.data.results).toHaveLength(5);
    const clamped = await search({ fetchImpl: async () => html(many), body: { query: "q", max_results: 100 } });
    expect(clamped.data.results).toHaveLength(25);
    expect(parseSearchParams({ query: "q", max_results: 100 }).maxResults).toBe(25);
  });

  it("rejects unsupported inputs before any network call", async () => {
    const fetchImpl = vi.fn();
    for (const body of [
      { query: "" }, { query: "   " }, { query: "a\u0000b" }, { query: "x".repeat(2001) }, { query: 7 },
      { query: "q", search_type: "news" }, { query: "q", search_type: "images" },
      { query: "q", country: "us" }, { query: "q", language: "en" }, { query: "q", time_range: "day" },
      { query: "q", offset: 10 }, { query: "q", domain_filter: ["a.com"] }, { query: "q", content_options: { full: true } },
      { query: "q", provider_options: { baseUrl: "http://127.0.0.1" } }, { query: "q", stream: true },
      { query: "q", max_results: 0 }, { query: "q", max_results: 1.5 }, { query: "q", max_results: 101 },
      { query: "q", provider: "duckduckgo-web" }, null, [],
    ]) {
      const result = await handleDuckDuckGoFreeSearchNative({ body, credentials: one, fetchImpl });
      expect(result).toMatchObject({ success: false, status: 400 });
    }
    expect(await handleDuckDuckGoFreeSearchNative({ body: { query: "q" }, fetchImpl, timeoutMs: 15_001 })).toMatchObject({ status: 400 });
    expect(await handleDuckDuckGoFreeSearchNative({ body: { query: "q" }, fetchImpl, timeoutMs: 0 })).toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
    // Empty/null route fields are accepted (the local route always forwards them).
    expect(parseSearchParams({ query: "q", country: null, domain_filter: [], provider_options: {}, offset: undefined }))
      .toEqual({ query: "q", searchType: "web", maxResults: 5 });
  });

  it("keeps two connections isolated: own proxy options and accounting scope, no credential leak", async () => {
    const fetchImpl = vi.fn(async () => html(LITE_HTML));
    const a = await search({ fetchImpl, credentials: one });
    const b = await search({ fetchImpl, credentials: two });
    expect(a.accounting.meta.connectionId).toBe("conn-one");
    expect(b.accounting.meta.connectionId).toBe("conn-two");
    expect(fetchImpl.mock.calls[0][2]).toMatchObject({ connectionProxyEnabled: false, connectionProxyUrl: "" });
    expect(fetchImpl.mock.calls[1][2]).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-two.test:8080" });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual(fetchImpl.mock.calls[1][1].headers);
    const wire = JSON.stringify([fetchImpl.mock.calls.map((c) => [c[0], c[1].headers, c[1].body]), await a.response.text(), await b.response.text()]);
    expect(wire).not.toMatch(/secret-one|secret-two/);
    const anon = await search({ fetchImpl, credentials: null });
    expect(anon.accounting.meta.connectionId).toBeNull();
  });

  it("reports honest unknown-cost accounting with one operation", async () => {
    const result = await search({ fetchImpl: async () => html(LITE_HTML) });
    expect(result.accounting).toMatchObject({ modality: "search", cost: null, costStatus: "unknown", costSource: "unavailable", nativeUnits: { operations: 1 } });
    expect(result.accounting.meta.providerUsage).toBeUndefined();
    expect(result.acceptedJob).toBeUndefined();
  });

  it("maps rate limits, anti-bot pages and refusals without relaying upstream bodies", async () => {
    const limited = await search({ fetchImpl: async () => html("<p>upstream-private slow down</p>", 429, { "retry-after": "30" }) });
    expect(limited).toMatchObject({ success: false, status: 429, rateLimited: true });
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    const anomaly = await search({ fetchImpl: async () => html("<div class='anomaly-modal'>upstream-private</div>") });
    expect(anomaly).toMatchObject({ success: false, status: 429, rateLimited: true });
    const deferred = await search({ fetchImpl: async () => html("", 202) });
    expect(deferred).toMatchObject({ success: false, status: 429 });
    const refused = await search({ fetchImpl: async () => html("upstream-private forbidden", 403) });
    expect(refused).toMatchObject({ success: false, status: 403 });
    expect(refused.quotaExhausted).toBeUndefined();
    for (const r of [limited, anomaly, deferred, refused]) {
      expect(await r.response.text()).not.toContain("upstream-private");
      expect(r.acceptedJob).toBeUndefined();
    }
  });

  it("marks 5xx as uncertain accepted work and never replays", async () => {
    const fetchImpl = vi.fn(async () => html("upstream-private boom", 503));
    const result = await search({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", meta: { jobState: "submit-unknown", connectionId: "conn-one" } });
    expect(await result.response.text()).not.toContain("upstream-private");
  });

  it("treats a lost socket after send as uncertain, and an unsent DNS failure as plain failure", async () => {
    const reset = vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); });
    const lost = await search({ fetchImpl: reset });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(lost).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    const dns = await search({ fetchImpl: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); } });
    expect(dns).toMatchObject({ status: 502 });
    expect(dns.acceptedJob).toBeUndefined();
  });

  it("refuses redirects and foreign response origins", async () => {
    const redirect = await search({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }) });
    expect(redirect).toMatchObject({ success: false, status: 502 });
    const opaque = await search({ fetchImpl: async () => ({ type: "opaqueredirect", status: 0, headers: new Headers() }) });
    expect(opaque).toMatchObject({ success: false, status: 502 });
    const foreign = html(LITE_HTML);
    Object.defineProperty(foreign, "url", { value: "https://evil.example/lite/" });
    const moved = await search({ fetchImpl: async () => foreign });
    expect(moved).toMatchObject({ success: false, status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
  });

  it("refuses malformed, oversized and non-HTML success bodies as unusable", async () => {
    const empty = await search({ fetchImpl: async () => html("") });
    expect(empty).toMatchObject({ success: false, status: 502, acceptedJob: { meta: { jobState: "completed-unusable" } } });
    const json = await search({ fetchImpl: async () => Response.json({ results: [{ url: "https://x.com" }] }) });
    expect(json).toMatchObject({ success: false, status: 502 });
    const huge = await search({ fetchImpl: async () => html("x".repeat(1024 * 1024 + 1)) });
    expect(huge).toMatchObject({ success: false, status: 502 });
    // A genuine no-results page stays a successful empty answer, as in the source.
    const none = await search({ fetchImpl: async () => html("<html><body>No results.</body></html>") });
    expect(none).toMatchObject({ success: true });
    expect(none.data.results).toEqual([]);
  });

  it("aborts in-flight requests on caller cancel and on deadline", async () => {
    const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const controller = new AbortController();
    const pending = search({ fetchImpl: vi.fn(hang), signal: controller.signal });
    controller.abort();
    const cancelled = await pending;
    expect(cancelled).toMatchObject({ success: false, status: 499 });
    const timed = await search({ fetchImpl: vi.fn(hang), timeoutMs: 20 });
    expect(timed).toMatchObject({ success: false, status: 504, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    const pre = new AbortController(); pre.abort();
    const fetchImpl = vi.fn();
    expect(await search({ fetchImpl, signal: pre.signal })).toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts a stalled body read at the deadline and cancels the stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } });
    const result = await search({ fetchImpl: async () => new Response(stream, { status: 200, headers: { "content-type": "text/html" } }), timeoutMs: 30 });
    expect(result).toMatchObject({ success: false, status: 504, acceptedJob: { meta: { jobState: "completed-unread" } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelled).toBe(true);
  });
});

describe("DuckDuckGo lite parser safety (source-derived + local hardening)", () => {
  it("strips highlights, decodes uddg redirects and upgrades protocol-relative hrefs", () => {
    const [r] = parseDuckDuckGoLite(LITE_HTML);
    expect(r.title).not.toMatch(/<b>/);
    expect(parseDuckDuckGoLite(`<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&rut=x" class='result-link'>Example</a><td class='result-snippet'>s</td>`)[0].url)
      .toBe("https://example.com/a?b=1");
    expect(parseDuckDuckGoLite(`<a href="//example.org/path" class='result-link'>P</a>`)[0].url).toBe("https://example.org/path");
    expect(parseDuckDuckGoLite(`<a href="https://x.com" class='result-link'>Only</a>`)[0].snippet).toBe("");
    expect(parseDuckDuckGoLite("")).toEqual([]);
  });

  it("drops non-http, credentialed and internal result URLs", () => {
    const html = [
      "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://user:pw@example.com/",
      "http://127.0.0.1/admin", "http://169.254.169.254/latest", "http://localhost:8080/", "http://[::1]/",
      "http://10.0.0.5/", `//duckduckgo.com/l/?uddg=${encodeURIComponent("http://192.168.1.1/")}`,
      `https://ok.example.com/${"a".repeat(2100)}`, "https://ok.example.com",
    ].map((href, i) => `<a href="${href}" class='result-link'>T${i}</a><td class='result-snippet'>s${i}</td>`).join("");
    const results = parseDuckDuckGoLite(html);
    expect(results).toEqual([{ url: "https://ok.example.com", title: "T11", snippet: "s11" }]);
    expect(resolveResultUrl("http://[::ffff:127.0.0.1]/")).toBe("");
  });

  it("never double-unescapes or emits live markup", () => {
    const [a] = parseDuckDuckGoLite(`<a href="https://e.com" class='result-link'>T</a><td class='result-snippet'>5 &amp;lt; 10</td>`);
    expect(a.snippet).toBe("5 &lt; 10");
    const [b] = parseDuckDuckGoLite(`<a href="https://e.com" class='result-link'>safe &lt;script&gt;x&lt;/script&gt; title</a><td class='result-snippet'>tail &lt;script foo</td>`);
    expect(b.title).not.toMatch(/<script/i);
    expect(b.snippet).not.toMatch(/<script/i);
    expect(b.snippet.startsWith("tail")).toBe(true);
  });

  it("is bounded on adversarial HTML", () => {
    const start = Date.now();
    const out = parseDuckDuckGoLite(`<a href="https://x.com" class='result-link'>`.repeat(2000) + "x".repeat(2_000_000));
    expect(Date.now() - start).toBeLessThan(1000);
    expect(Array.isArray(out)).toBe(true);
    expect(isAnomalyPage("<div id='anomaly-modal'>")).toBe(true);
    expect(isAnomalyPage(LITE_HTML)).toBe(false);
  });

  it("adapter object exposes the staged contract", () => {
    const params = duckduckgoSearchAdapter.parseParams({ query: "q" });
    expect(duckduckgoSearchAdapter.buildRequest(params).url).toBe(DDG_LITE_URL);
    expect(duckduckgoSearchAdapter.normalize(LITE_HTML, params, 0).results).toHaveLength(2);
  });
});

describe("staging state (isolated; registration promotes this block)", () => {
  const root = new URL("../../", import.meta.url);
  it("is unregistered and not imported by production registries/handlers", () => {
    const registration = JSON.parse(readFileSync(new URL("open-sse/services/providerParity/native-duckduckgo-search-search/registration.json", root), "utf8"));
    expect(registration).toMatchObject({ registered: false, canonicalId: "duckduckgo-free", aliases: ["duckduckgo"], serviceKinds: ["webSearch"] });
    expect(registration.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    for (const file of ["open-sse/providers/registry/index.js", "open-sse/handlers/search/index.js", "open-sse/handlers/search/callers.js"]) {
      const text = readFileSync(new URL(file, root), "utf8");
      expect(text).not.toContain("native-duckduckgo-search-search");
      expect(text).not.toContain("duckduckgo-free");
    }
  });
});
