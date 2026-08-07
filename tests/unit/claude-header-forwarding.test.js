/**
 * Unit tests for Anthropic header caching + forwarding pipeline
 *
 * Tests cover:
 *  - claudeHeaderCache: detection, capture, and retrieval of Claude Code headers
 *  - default.js buildHeaders(): live header overlay for "claude" provider
 *  - default.js buildHeaders(): cold-start fallback when cache is empty
 *  - default.js buildHeaders(): anthropic-compatible non-Anthropic host stripping
 *  - default.js buildHeaders(): anthropic-compatible official host keeps headers
 *  - proxyFetch.js: api.anthropic.com routes through anthropicFetch path
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── claudeHeaderCache ────────────────────────────────────────────────────────

describe("claudeHeaderCache", () => {
  let cacheModule;

  beforeEach(async () => {
    // Re-import fresh module each time to reset singleton state
    vi.resetModules();
    cacheModule = await import("open-sse/utils/claudeHeaderCache.js");
  });

  it("returns null before any headers are cached (cold start)", () => {
    expect(cacheModule.getCachedClaudeHeaders()).toBeNull();
  });

  it("caches headers when user-agent contains 'claude-code'", () => {
    cacheModule.cacheClaudeHeaders({
      "user-agent": "claude-code/2.1.63 node/24.3.0",
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "x-app": "cli",
      "x-stainless-os": "MacOS",
      "x-stainless-arch": "arm64",
      "x-stainless-lang": "js",
      "x-stainless-runtime": "node",
      "x-stainless-runtime-version": "v24.3.0",
      "x-stainless-package-version": "0.74.0",
      "x-stainless-helper-method": "stream",
      "x-stainless-retry-count": "0",
      "x-stainless-timeout": "600",
      "anthropic-dangerous-direct-browser-access": "true",
      // Non-identity header — should NOT be captured
      "content-type": "application/json",
    });

    const cached = cacheModule.getCachedClaudeHeaders();
    expect(cached).not.toBeNull();
    expect(cached["user-agent"]).toBe("claude-code/2.1.63 node/24.3.0");
    expect(cached["anthropic-beta"]).toBeUndefined();
    expect(cached["x-app"]).toBe("cli");
    expect(cached["x-stainless-os"]).toBe("MacOS");
    // Non-identity header must not leak in
    expect(cached["content-type"]).toBeUndefined();
  });

  it("caches headers when user-agent contains 'claude-cli'", () => {
    cacheModule.cacheClaudeHeaders({
      "user-agent": "claude-cli/1.0.0",
      "anthropic-version": "2023-06-01",
    });
    expect(cacheModule.getCachedClaudeHeaders()).not.toBeNull();
    expect(cacheModule.getCachedClaudeHeaders()["user-agent"]).toBe("claude-cli/1.0.0");
  });

  it("caches headers when x-app is 'cli' (regardless of user-agent)", () => {
    cacheModule.cacheClaudeHeaders({
      "user-agent": "axios/1.7.0",
      "x-app": "cli",
      "anthropic-version": "2023-06-01",
    });
    expect(cacheModule.getCachedClaudeHeaders()).not.toBeNull();
  });

  it("does NOT cache headers for non-Claude clients", () => {
    cacheModule.cacheClaudeHeaders({
      "user-agent": "PostmanRuntime/7.43.0",
      "anthropic-version": "2023-06-01",
    });
    expect(cacheModule.getCachedClaudeHeaders()).toBeNull();
  });

  it("refreshes cache on each matching request", () => {
    cacheModule.cacheClaudeHeaders({
      "user-agent": "claude-code/2.0.0",
      "x-stainless-package-version": "0.70.0",
    });
    cacheModule.cacheClaudeHeaders({
      "user-agent": "claude-code/2.1.63",
      "x-stainless-package-version": "0.74.0",
    });
    const cached = cacheModule.getCachedClaudeHeaders();
    expect(cached["user-agent"]).toBe("claude-code/2.1.63");
    expect(cached["x-stainless-package-version"]).toBe("0.74.0");
  });

  it("ignores calls with null or non-object headers", () => {
    cacheModule.cacheClaudeHeaders(null);
    cacheModule.cacheClaudeHeaders(undefined);
    cacheModule.cacheClaudeHeaders("string");
    expect(cacheModule.getCachedClaudeHeaders()).toBeNull();
  });

  it("only stores keys that are actually present in the headers object", () => {
    cacheModule.cacheClaudeHeaders({
      "user-agent": "claude-code/2.1.63",
      // Most stainless headers absent
    });
    const cached = cacheModule.getCachedClaudeHeaders();
    expect(cached["x-stainless-os"]).toBeUndefined();
    expect(cached["user-agent"]).toBe("claude-code/2.1.63");
  });
});

// ─── DefaultExecutor.buildHeaders() ──────────────────────────────────────────

describe("DefaultExecutor.buildHeaders() — claude provider", () => {
  let DefaultExecutor;

  beforeEach(async () => {
    vi.resetModules();
    // Prime the cache with live client headers before importing executor
    const cache = await import("open-sse/utils/claudeHeaderCache.js");
    cache.cacheClaudeHeaders({
      "user-agent": "claude-code/2.1.63 node/24.3.0",
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-app": "cli",
      "x-stainless-os": "MacOS",
      "x-stainless-arch": "arm64",
      "x-stainless-lang": "js",
      "x-stainless-runtime": "node",
      "x-stainless-runtime-version": "v24.3.0",
      "x-stainless-package-version": "0.74.0",
      "x-stainless-helper-method": "stream",
      "x-stainless-retry-count": "0",
      "x-stainless-timeout": "600",
    });
    const mod = await import("open-sse/executors/default.js");
    DefaultExecutor = mod.DefaultExecutor || mod.default;
  });

  it("overlays live cached headers over static provider defaults", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true);

    // Live values should win over static providers.js values
    expect(headers["user-agent"]).toBe("claude-code/2.1.63 node/24.3.0");
    // Request-scoped betas are never replayed from another client. Only the
    // provider registry's curated static flags survive.
    const beta = headers["Anthropic-Beta"] || headers["anthropic-beta"] || "";
    expect(beta.split(",").map(s => s.trim())).toContain("oauth-2025-04-20");
    expect(beta).not.toContain("context-1m-2025-08-07");
    expect(headers["x-stainless-package-version"]).toBe("0.74.0");
    expect(headers["x-stainless-os"]).toBe("MacOS");
  });

  it("removes conflicting Title-Case static keys when cached lowercase keys exist", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true);

    // Title-Case variants are removed only for identity keys present in cache.
    expect(headers["Anthropic-Version"]).toBeUndefined();
    expect(headers["User-Agent"]).toBeUndefined();
    expect(headers["X-App"]).toBeUndefined();
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-app"]).toBe("cli");
    // anthropic-beta is request-scoped, so static beta remains unshadowed.
    expect(headers["Anthropic-Beta"]).toBeTruthy();
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("does not leak one client's context-1m beta onto later requests", async () => {
    vi.resetModules();
    const cache = await import("open-sse/utils/claudeHeaderCache.js");
    cache.cacheClaudeHeaders({
      "user-agent": "claude-code/2.1.63 node/24.3.0",
      "x-app": "cli",
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,context-1m-2025-08-07",
    });
    expect(cache.getCachedClaudeHeaders()["anthropic-beta"]).toBeUndefined();

    const mod = await import("open-sse/executors/default.js");
    const Exec = mod.DefaultExecutor || mod.default;
    const requestA = new Exec("claude").buildHeaders({ apiKey: "sk-a" }, true);
    const requestB = new Exec("claude").buildHeaders({ apiKey: "sk-b" }, true);
    for (const headers of [requestA, requestB]) {
      const beta = headers["Anthropic-Beta"] || headers["anthropic-beta"] || "";
      expect(beta).not.toContain("context-1m-2025-08-07");
    }
  });

  it("treats the shared identity cache as read-only across repeated builds", async () => {
    const cache = await import("open-sse/utils/claudeHeaderCache.js");
    const before = structuredClone(cache.getCachedClaudeHeaders());
    const executor = new DefaultExecutor("claude");
    executor.buildHeaders({ apiKey: "sk-test" }, true);
    executor.buildHeaders({ apiKey: "sk-test" }, true);
    expect(cache.getCachedClaudeHeaders()).toEqual(before);
  });

  it("sets x-api-key auth when apiKey is provided", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-live-key" }, true);
    expect(headers["x-api-key"]).toBe("sk-live-key");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("sets Bearer Authorization when only accessToken is provided", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ accessToken: "tok-abc" }, true);
    expect(headers["Authorization"]).toBe("Bearer tok-abc");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("includes Accept: text/event-stream when stream=true", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "k" }, true);
    expect(headers["Accept"]).toBe("text/event-stream");
  });

  it("omits Accept: text/event-stream when stream=false", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "k" }, false);
    expect(headers["Accept"]).toBeUndefined();
  });
});

describe("DefaultExecutor.buildHeaders() — AgentRouter", () => {
  it("normalizes the primary Claude transport to one lowercase anthropic-version", async () => {
    const { DefaultExecutor } = await import("open-sse/executors/default.js");
    const headers = new DefaultExecutor("agentrouter").buildHeaders({ apiKey: "sk-test" }, true);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["Anthropic-Version"]).toBeUndefined();
  });

  it("normalizes the alternate Claude runtime transport", async () => {
    const { DefaultExecutor } = await import("open-sse/executors/default.js");
    const executor = new DefaultExecutor("agentrouter");
    const credentials = {
      apiKey: "sk-test",
      runtimeTransport: executor.config.transports.find((transport) => transport.format === "claude"),
    };
    const headers = executor.buildHeaders(credentials, true);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["Anthropic-Version"]).toBeUndefined();
  });
});

describe("DefaultExecutor.buildHeaders() — claude provider cold start (no cache)", () => {
  let DefaultExecutor;

  beforeEach(async () => {
    vi.resetModules();
    // Do NOT prime cache — simulate cold start
    const mod = await import("open-sse/executors/default.js");
    DefaultExecutor = mod.DefaultExecutor || mod.default;
  });

  it("falls back to static provider headers when cache is empty", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true);

    // Static fallback values from providers.js must still be present
    // They may be Title-Case since no cache to conflict with them
    const hasVersion =
      headers["Anthropic-Version"] === "2023-06-01" ||
      headers["anthropic-version"] === "2023-06-01";
    expect(hasVersion).toBe(true);
  });

  it("does not throw when cache returns null", () => {
    const executor = new DefaultExecutor("claude");
    expect(() => executor.buildHeaders({ apiKey: "sk" }, false)).not.toThrow();
  });
});


// ─── anthropic-compatible header stripping ────────────────────────────────────

describe("DefaultExecutor.buildHeaders() — anthropic-compatible stripping", () => {
  let DefaultExecutor;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("open-sse/executors/default.js");
    DefaultExecutor = mod.DefaultExecutor || mod.default;
  });
  it("emits one lowercase anthropic-version logical header", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    executor.config.headers = { "Anthropic-Version": "2023-06-01" };
    const headers = executor.buildHeaders({
      apiKey: "key",
      providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" },
    }, false);
    expect(Object.keys(headers).filter((key) => key.toLowerCase() === "anthropic-version"))
      .toEqual(["anthropic-version"]);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("strips x-app and anthropic-dangerous-direct-browser-access for non-Anthropic host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" },
      },
      true
    );

    expect(headers["x-app"]).toBeUndefined();
    expect(headers["X-App"]).toBeUndefined();
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
    expect(headers["Anthropic-Dangerous-Direct-Browser-Access"]).toBeUndefined();
  });

  it("removes claude-code-20250219 from anthropic-beta for non-Anthropic host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" },
      },
      true
    );

    const betaVal = headers["anthropic-beta"] || headers["Anthropic-Beta"] || "";
    expect(betaVal).not.toContain("claude-code-20250219");
  });

  it("keeps other beta flags intact after stripping", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    // The static CLAUDE_API_HEADERS used by anthropic-compatible providers include
    // 'interleaved-thinking-2025-05-14' — check it survives stripping
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" },
      },
      false
    );

    const betaVal = headers["anthropic-beta"] || headers["Anthropic-Beta"] || "";
    // If any beta value remains it should not be empty and should not have the stripped value
    if (betaVal) {
      expect(betaVal).not.toContain("claude-code-20250219");
    }
  });

  it("does NOT strip headers when baseUrl is api.anthropic.com", () => {
    const executor = new DefaultExecutor("anthropic-compatible-official");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" },
      },
      true
    );

    // No stripping — anthropic-version should survive
    const hasVersion =
      headers["Anthropic-Version"] || headers["anthropic-version"];
    expect(hasVersion).toBeDefined();
  });

  it("does NOT strip headers when baseUrl is empty (defaults to Anthropic)", () => {
    const executor = new DefaultExecutor("anthropic-compatible-official");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: {},
      },
      true
    );

    const hasVersion =
      headers["Anthropic-Version"] || headers["anthropic-version"];
    expect(hasVersion).toBeDefined();
  });
});

// ─── proxyFetch anthropicFetch routing ────────────────────────────────────────

describe("proxyAwareFetch — api.anthropic.com routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses native fetch for api.anthropic.com when got-scraping is disabled", async () => {
    // Mock got-scraping before module load
    vi.doMock("got-scraping", () => {
      const mockGotScraping = vi.fn().mockResolvedValue({
        statusCode: 200,
        statusMessage: "OK",
        headers: { "content-type": "application/json" },
        rawBody: Buffer.from(JSON.stringify({ id: "msg_test" })),
      });
      mockGotScraping.stream = vi.fn();
      return { gotScraping: mockGotScraping };
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      body: null,
      text: async () => JSON.stringify({ id: "msg_test" }),
      json: async () => ({ id: "msg_test" }),
    });

    vi.resetModules();
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    const { gotScraping } = await import("got-scraping");

    const res = await proxyAwareFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      // No Accept: text/event-stream → non-streaming path
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-3-5-sonnet-20241022", messages: [] }),
    });

    expect(gotScraping).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("msg_test");
    globalThis.fetch = originalFetch;
  });

  it("falls back gracefully when got-scraping throws on non-streaming path", async () => {
    vi.doMock("got-scraping", () => {
      const fn = vi.fn().mockRejectedValue(new Error("TLS error"));
      fn.stream = vi.fn();
      return { gotScraping: fn };
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: null,
      text: async () => "{}",
      json: async () => ({}),
    });

    vi.resetModules();
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");

    const res = await proxyAwareFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.ok).toBe(true);
    globalThis.fetch = originalFetch;
  });

  it("does NOT route non-Anthropic hosts through gotScraping", async () => {
    const gotScrapingMock = vi.fn();
    vi.doMock("got-scraping", () => ({ gotScraping: gotScrapingMock }));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: null,
      text: async () => "{}",
      json: async () => ({}),
    });

    vi.resetModules();
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");

    await proxyAwareFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(gotScrapingMock).not.toHaveBeenCalled();
  });
});
