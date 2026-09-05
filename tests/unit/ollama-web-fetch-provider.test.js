import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAccountError: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(async () => null),
  getApiKeyByKey: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getDisabledModels: vi.fn(async () => ({})),
  getModelAliases: vi.fn(async () => ({})),
  getProviderConnections: vi.fn(),
  getProviderCredentials: vi.fn(),
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  markAccountUnavailable: vi.fn(),
  recordApiKeyUsageForResponse: vi.fn(async (_apiKey, response) => response),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: mocks.getApiKeyByKey,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("../../src/sse/services/auth.js", () => ({
  clearAccountError: mocks.clearAccountError,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  projectProviderCredentials: vi.fn((connection) => connection),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true } })),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
  recordApiKeyUsageForResponse: mocks.recordApiKeyUsageForResponse,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("../../src/sse/services/model.js", () => ({ getAutoComboCatalog: vi.fn() }));
vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(), error: vi.fn(), info: vi.fn(), request: vi.fn(), warn: vi.fn(),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";
import { resolveFallbackModelScope } from "../../open-sse/services/fallbackScope.js";
import { handleFetch, normalizeFetchProviderInput } from "../../src/sse/handlers/fetch.js";

const OLLAMA_CONFIG = REGISTRY.find(({ id }) => id === "ollama").fetchConfig;
const OLLAMA_CONNECTION = {
  id: "ollama-connection",
  provider: "ollama",
  connectionName: "Ollama Cloud",
  apiKey: "ollama-test-key",
  isActive: true,
};
const originalFetch = globalThis.fetch;

function coreRequest(overrides = {}) {
  return handleFetchCore({
    url: "https://example.com/article",
    format: "markdown",
    provider: "ollama",
    providerConfig: OLLAMA_CONFIG,
    credentials: { apiKey: "ollama-test-key" },
    ...overrides,
  });
}

function routeRequest() {
  return new Request("http://localhost/v1/web/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "ollama/fetch", url: "https://example.com/article" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([OLLAMA_CONNECTION]);
  mocks.getProviderCredentials.mockResolvedValue({
    ...OLLAMA_CONNECTION,
    connectionId: OLLAMA_CONNECTION.id,
    _connection: OLLAMA_CONNECTION,
  });
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe("Ollama Cloud web fetch provider", () => {
  it("registers and advertises ollama/fetch", async () => {
    expect(OLLAMA_CONFIG).toMatchObject({
      baseUrl: "https://ollama.com/api/web_fetch",
      method: "POST",
      authType: "apikey",
      authHeader: "bearer",
      costPerQuery: 0,
      freeMonthlyQuota: 1000,
      formats: ["markdown"],
      maxCharacters: 4096,
      truncateBytes: 4096,
      timeoutMs: 5000,
    });

    const models = await buildModelsList(["webFetch"]);
    expect(models).toContainEqual({
      id: "ollama/fetch",
      object: "model",
      kind: "webFetch",
      owned_by: "ollama",
    });
    expect(normalizeFetchProviderInput("ollama/fetch")).toBe("ollama");
    expect(resolveFallbackModelScope("ollama", "webfetch:ollama")).toBeNull();
    expect(resolveFallbackModelScope("ollama", null, { webFetch: true })).toBe("webfetch:ollama");
    expect(resolveFallbackModelScope("ollama", "unknown-user-scope")).toBeNull();
  });

  it("POSTs the documented request and normalizes links with Unicode-safe byte truncation", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      title: "Example",
      content: "A😀BC",
      links: ["https://example.com/next"],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await coreRequest({ maxCharacters: undefined, providerConfig: { ...OLLAMA_CONFIG, truncateBytes: 5 } });

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [endpoint, init] = globalThis.fetch.mock.calls[0];
    expect(endpoint).toBe("https://ollama.com/api/web_fetch");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer ollama-test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com/article" }),
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        provider: "ollama",
        title: "Example",
        content: { format: "markdown", text: "A😀", length: 3 },
        links: ["https://example.com/next"],
      },
    });
  });

  it("classifies non-2xx responses and redacts echoed credentials", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      "rejected ollama-test-key",
      { status: 401, headers: { "content-type": "text/plain" } },
    ));

    await expect(coreRequest()).resolves.toMatchObject({
      success: false,
      status: 401,
      error: "Ollama upstream error (401): rejected [redacted]",
    });
  });

  it("classifies malformed successful responses", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ title: "Missing content", links: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    await expect(coreRequest()).resolves.toMatchObject({
      success: false,
      status: 502,
      error: "Ollama response normalization failed: content must be a non-empty string",
    });

    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ content: "ok", links: "not-an-array" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(coreRequest()).resolves.toMatchObject({
      success: false,
      status: 502,
      error: "Ollama response normalization failed: links must be an array",
    });
  });

  it("aborts Ollama after five seconds", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));

    const pending = coreRequest();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toMatchObject({ success: false, status: 504 });
    expect(globalThis.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("clears only webfetch:ollama after success", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ title: "Example", content: "ok", links: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    expect((await handleFetch(routeRequest())).status).toBe(200);
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "ollama", expect.any(Set), null, expect.objectContaining({ webFetch: true }),
    );
    expect(mocks.clearAccountError).toHaveBeenCalledWith(
      "ollama-connection", expect.any(Object), null, expect.objectContaining({ webFetch: true }),
    );
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("marks only webfetch:ollama after failure", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: "quota exceeded" }),
      { status: 429, headers: { "content-type": "application/json" } },
    ));

    expect((await handleFetch(routeRequest())).status).toBe(429);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "ollama-connection",
      429,
      "Ollama upstream error (429): quota exceeded",
      "ollama",
      null,
      null,
      expect.objectContaining({ webFetch: true }),
    );
    expect(mocks.clearAccountError).not.toHaveBeenCalled();
  });
});
