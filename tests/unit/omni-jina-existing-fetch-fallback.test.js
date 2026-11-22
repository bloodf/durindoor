import { beforeEach, describe, expect, it, vi } from "vitest";

// OmniRoute #18455: automatic web-fetch selection must continue past a Jina
// Reader HTTP 402 (insufficient balance) but not past Jina 401/403, and an
// explicit provider must never be replaced. DurinDoor already routes through
// `handleFetch` -> `handleComboChat` -> `checkFallbackError`, so these tests
// drive that real chain offline. Only the network, the database, credential
// selection and usage recording are stubbed.

const state = vi.hoisted(() => ({
  combos: [],
  upstream: vi.fn(),
  calls: [],
  usage: vi.fn(async (_key, response) => response),
  mark: vi.fn(),
  clear: vi.fn(),
  routeModels: [],
  connections: {},
  excluded: [],
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getCombos: vi.fn(async () => state.combos),
  getComboForModel: vi.fn(async (name) => state.combos.find((combo) => combo.name === name)),
  getApiKeyByKey: vi.fn(async () => null),
  getProviderConnections: vi.fn(async () => []),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "test-key", auth: { ok: true, apiKeyId: "key" } })),
  // Credential routing: one account per provider; an excluded account is gone.
  getProviderCredentialsWithQuotaPreflight: vi.fn(async (providerId, excluded) => {
    state.excluded.push([providerId, [...excluded]]);
    const connection = state.connections[providerId];
    return connection && !excluded.has(connection.connectionId) ? connection : null;
  }),
  getNoAuthProviderCredentials: vi.fn(),
  // Real classifier, so the account-level decision is the shipped one.
  markAccountUnavailable: state.mark,
  clearAccountError: state.clear,
  projectProviderCredentials: vi.fn(),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
  recordApiKeyUsageForResponse: state.usage,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));
vi.mock("../../src/sse/services/model.js", () => ({ getAutoComboCatalog: vi.fn() }));
vi.mock("../../src/sse/services/mediaRoutes.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveMediaRoute: vi.fn(async () => ({ models: state.routeModels })),
}));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({
  getRequestId: () => "request",
  withRequestCorrelation: (handler) => handler,
}));
vi.mock("@/shared/utils/ssrfGuard.js", async (importOriginal) => ({
  ...(await importOriginal()),
  assertPublicUrlResolved: vi.fn(async () => {}),
}));
vi.mock("open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));
// The shipped provider adapters stay real; only the pinned network call is replaced.
vi.mock("open-sse/utils/outboundUrlGuard.js", async (importOriginal) => ({
  ...(await importOriginal()),
  guardedProbeFetch: vi.fn(async (url, init) => state.upstream(new URL(String(url)), init)),
}));

const { handleFetch } = await import("../../src/sse/handlers/fetch.js");
const { checkFallbackError } = await import("open-sse/services/accountFallback.js");

const json = (status, body) => Response.json(body, { status });
const BALANCE_402 = () => json(402, { name: "InsufficientBalanceError", status: 40203 });
const FIRECRAWL_OK = () => json(200, { data: { markdown: "firecrawl content" } });
const TAVILY_OK = () => json(200, { results: [{ raw_content: "tavily content" }] });
const JINA_OK = () => new Response("# Title\njina content", { status: 200 });

function connection(providerId) {
  return {
    connectionId: `${providerId}-account`,
    connectionName: `${providerId} account`,
    apiKey: `${providerId}-test-key`,
  };
}

/** Per-host upstream script; every other host is an unexpected network call. */
function script(handlers) {
  state.upstream.mockImplementation(async (url) => {
    state.calls.push(url.hostname);
    const handler = handlers[url.hostname];
    if (!handler) throw new Error(`Unexpected upstream: ${url.hostname}`);
    return handler();
  });
}

function post(body) {
  return handleFetch(new Request("http://localhost/v1/web/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/article", ...body }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.combos = [];
  state.calls = [];
  state.excluded = [];
  state.routeModels = ["firecrawl/fetch", "jina-reader/fetch", "tavily/fetch"];
  state.connections = {
    firecrawl: connection("firecrawl"),
    "jina-reader": connection("jina-reader"),
    tavily: connection("tavily"),
  };
  state.mark.mockImplementation(async (_id, status, error, providerId) => {
    const { shouldFallback } = checkFallbackError(status, error, 0, providerId);
    return { shouldFallback };
  });
});

describe("existing fallback after Jina insufficient balance (OmniRoute #18455)", () => {
  it("classifies Jina 402 as a fallback signal and keeps 401/403 on the existing path", () => {
    // Positive: a balance error is account-terminal and moves to the next provider.
    expect(checkFallbackError(402, '{"name":"InsufficientBalanceError"}', 0, "jina-reader"))
      .toMatchObject({ shouldFallback: true, terminal: true });
    // The classifier is provider-agnostic here: 401/403 share the same long-cooldown
    // rotation as every other provider, with no Jina-specific 402-only rule.
    expect(checkFallbackError(401, "Unauthorized", 0, "jina-reader").shouldFallback).toBe(true);
    expect(checkFallbackError(403, "Forbidden", 0, "jina-reader").shouldFallback).toBe(true);
  });

  it("default route: Firecrawl 403 -> Jina 402 -> Tavily 200 serves the request", async () => {
    script({
      "api.firecrawl.dev": () => json(403, { error: "we do not support this site" }),
      "r.jina.ai": BALANCE_402,
      "api.tavily.com": TAVILY_OK,
    });

    const response = await post({});

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.provider).toBe("tavily");
    expect(body.content.text).toBe("tavily content");
    expect(state.calls).toEqual(["api.firecrawl.dev", "r.jina.ai", "api.tavily.com"]);
  });

  it("configured combo: Jina 402 continues to the next member in order", async () => {
    state.combos = [{ name: "reader-chain", models: ["jina-reader/fetch", "tavily/fetch"] }];
    script({ "r.jina.ai": BALANCE_402, "api.tavily.com": TAVILY_OK });

    const response = await post({ model: "reader-chain" });

    expect(response.status).toBe(200);
    expect((await response.json()).provider).toBe("tavily");
    expect(state.calls).toEqual(["r.jina.ai", "api.tavily.com"]);
  });

  it("credentials: the exhausted Jina account is marked with the real status and excluded, not retried", async () => {
    script({ "r.jina.ai": BALANCE_402, "api.tavily.com": TAVILY_OK });
    state.routeModels = ["jina-reader/fetch", "tavily/fetch"];

    await post({});

    expect(state.mark).toHaveBeenCalledTimes(1);
    expect(state.mark).toHaveBeenCalledWith(
      "jina-reader-account", 402, expect.stringContaining("InsufficientBalanceError"),
      "jina-reader", null, null, { webFetch: true },
    );
    // The loop asked for a second Jina account (excluding the first) and found none;
    // it never re-dialled Jina with the same credential.
    expect(state.excluded).toContainEqual(["jina-reader", ["jina-reader-account"]]);
    expect(state.calls.filter((host) => host === "r.jina.ai")).toHaveLength(1);
  });

  it("accounting: the failed Jina attempt records no usage; only the serving provider does", async () => {
    script({ "r.jina.ai": BALANCE_402, "api.tavily.com": TAVILY_OK });
    state.routeModels = ["jina-reader/fetch", "tavily/fetch"];

    await post({});

    expect(state.usage).toHaveBeenCalledTimes(1);
    expect(state.usage.mock.calls[0][2]).toMatchObject({ provider: "tavily", modality: "webFetch" });
  });

  it("success on Jina first does not touch later providers", async () => {
    script({ "r.jina.ai": JINA_OK });
    state.routeModels = ["jina-reader/fetch", "tavily/fetch"];

    const response = await post({});

    expect(response.status).toBe(200);
    expect((await response.json()).provider).toBe("jina-reader");
    expect(state.calls).toEqual(["r.jina.ai"]);
    expect(state.usage.mock.calls[0][2]).toMatchObject({ provider: "jina-reader" });
  });

  it("explicit provider: Jina 402 is returned and no other provider is chosen", async () => {
    script({ "r.jina.ai": BALANCE_402, "api.tavily.com": TAVILY_OK });

    const response = await post({ provider: "jina-reader" });

    expect(response.status).toBe(402);
    expect(state.calls).toEqual(["r.jina.ai"]);
    expect(state.usage).not.toHaveBeenCalled();
  });

  it("explicit model form `jina-reader/fetch` is likewise never replaced", async () => {
    script({ "r.jina.ai": BALANCE_402, "api.tavily.com": TAVILY_OK });

    const response = await post({ model: "jina-reader/fetch" });

    expect(response.status).toBe(402);
    expect(state.calls).toEqual(["r.jina.ai"]);
  });

  it("explicit provider: Jina 401 and 403 surface unchanged", async () => {
    for (const status of [401, 403]) {
      state.calls = [];
      script({ "r.jina.ai": () => json(status, { error: "Access denied" }), "api.tavily.com": TAVILY_OK });

      const response = await post({ provider: "jina-reader" });

      expect(response.status).toBe(status);
      expect(state.calls).toEqual(["r.jina.ai"]);
    }
  });

  it("exhausted pool: Jina 402 as the only route member is reported, with the 402 status", async () => {
    state.routeModels = ["jina-reader/fetch"];
    script({ "r.jina.ai": BALANCE_402 });

    const response = await post({});

    expect(response.status).toBe(402);
    expect(state.calls).toEqual(["r.jina.ai"]);
    expect(state.usage).not.toHaveBeenCalled();
  });

  it("the default route never adds a provider it was not given", async () => {
    state.routeModels = ["jina-reader/fetch"];
    script({ "r.jina.ai": BALANCE_402, "api.tavily.com": TAVILY_OK, "api.firecrawl.dev": FIRECRAWL_OK });

    await post({});

    expect(state.calls).toEqual(["r.jina.ai"]);
  });

  it("a provider without a saved account is not dialled after Jina 402", async () => {
    delete state.connections.tavily;
    state.routeModels = ["jina-reader/fetch", "tavily/fetch"];
    script({ "r.jina.ai": BALANCE_402, "api.tavily.com": TAVILY_OK });

    const response = await post({});

    // The combo reports its aggregate failure; the credential-less member is skipped.
    expect(response.ok).toBe(false);
    expect(state.calls).toEqual(["r.jina.ai"]);
    expect(state.usage).not.toHaveBeenCalled();
  });

  it("default route: a sole Jina 401/403 surfaces its own status with no usage recorded", async () => {
    state.routeModels = ["jina-reader/fetch"];
    for (const status of [401, 403]) {
      state.calls = [];
      script({ "r.jina.ai": () => json(status, { error: "Access denied" }) });

      const response = await post({});

      expect(response.status).toBe(status);
      expect(state.calls).toEqual(["r.jina.ai"]);
    }
    expect(state.usage).not.toHaveBeenCalled();
  });

  // Characterization, not a port: the existing combo loop treats 401/403 like
  // every other account-scoped status and rotates to the next member. OmniRoute
  // #18455 stops there instead. This fork keeps its existing rotation; the
  // 402 change neither adds nor removes it.
  it("default route: Jina 401/403 follow the existing member rotation, unchanged by the 402 case", async () => {
    state.routeModels = ["jina-reader/fetch", "tavily/fetch"];
    for (const status of [401, 403]) {
      state.calls = [];
      script({ "r.jina.ai": () => json(status, { error: "Access denied" }), "api.tavily.com": TAVILY_OK });

      const response = await post({});

      expect(response.status).toBe(200);
      expect(state.calls).toEqual(["r.jina.ai", "api.tavily.com"]);
    }
  });
});

describe("Jina Reader adapter status pass-through", () => {
  it("returns the upstream 402 body and status without remapping", async () => {
    const { handleFetchCore } = await import("open-sse/handlers/fetch/index.js");
    script({ "r.jina.ai": BALANCE_402 });

    const result = await handleFetchCore({
      url: "https://example.com/article",
      provider: "jina-reader",
      credentials: { apiKey: "jina-test-key" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(402);
    expect(result.error).toContain("InsufficientBalanceError");
    expect(result.error).not.toContain("jina-test-key");
  });
});
