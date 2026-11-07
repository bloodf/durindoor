import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  combos: [],
  credentials: vi.fn(),
  noAuth: vi.fn(),
  markUnavailable: vi.fn(),
  recordUsage: vi.fn(async (_key, response) => response),
  fetchCore: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ comboStrategies: { "fetch-kind": { fallbackStrategy: "smart-scoring" } } })),
  getCombos: vi.fn(async () => state.combos),
  getComboForModel: vi.fn(async (name) => state.combos.find((combo) => combo.name === name)),
  getApiKeyByKey: vi.fn(async () => null),
  getProviderConnections: vi.fn(async () => []),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "test-key", auth: { ok: true, apiKeyId: "key" } })),
  getProviderCredentialsWithQuotaPreflight: state.credentials,
  getNoAuthProviderCredentials: state.noAuth,
  markAccountUnavailable: state.markUnavailable,
  clearAccountError: vi.fn(),
  projectProviderCredentials: vi.fn(),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
  recordApiKeyUsageForResponse: state.recordUsage,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: vi.fn() }));
vi.mock("../../src/sse/services/model.js", () => ({ getAutoComboCatalog: vi.fn() }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: vi.fn() }));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({ getRequestId: () => "request", withRequestCorrelation: (handler) => handler }));
vi.mock("@/shared/utils/ssrfGuard.js", () => ({ assertPublicUrlResolved: vi.fn(async () => {}) }));
vi.mock("open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));
vi.mock("open-sse/handlers/fetch/index.js", () => ({ handleFetchCore: state.fetchCore }));

const { handleFetch } = await import("../../src/sse/handlers/fetch.js");
const { getComboModelQuotaHealth, resetComboScoring } = await import("open-sse/services/combo.js");

function request(model) {
  return new Request("http://localhost/v1/web/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, url: "https://example.com/article" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.combos = [];
  resetComboScoring("fetch-kind");
});

describe("fetch rejects a chat model", () => {
  it.each([false, true])("rejects the wrong kind without charging or degrading health (combo: %s)", async (combo) => {
    const member = "openai/gpt-4o";
    if (combo) state.combos = [{ name: "fetch-kind", models: [member] }];

    const response = await handleFetch(request(combo ? "fetch-kind" : member));

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("Unknown provider");
    expect(state.credentials).not.toHaveBeenCalled();
    expect(state.noAuth).not.toHaveBeenCalled();
    expect(state.fetchCore).not.toHaveBeenCalled();
    expect(state.recordUsage).not.toHaveBeenCalled();
    expect(state.markUnavailable).not.toHaveBeenCalled();
    if (combo) expect(getComboModelQuotaHealth("fetch-kind", member)).toBe("healthy");
  });
});
