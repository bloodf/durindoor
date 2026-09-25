// Upstream 9router #4318: the dashboard's disabled-model list
// (POST /api/models/disabled) only filtered combo members. A direct request
// for a disabled model still picked an account and called the upstream.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProviderNodes: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(async () => []),
  getQuotaReservationPressure: vi.fn(async () => new Map()),
  getProviderNodes: mocks.getProviderNodes,
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  })),
  pickProxyPoolId: vi.fn(() => null),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { isProviderModelDisabled } = await import("../../src/sse/services/disabledModelGate.js");

function connection(provider) {
  return {
    id: `conn-${provider}-1111`,
    provider,
    connectionName: "acct-1",
    authType: "apikey",
    apiKey: "key-1",
    isActive: true,
    priority: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first" });
  mocks.getProviderNodes.mockResolvedValue([]);
  mocks.getDisabledModels.mockResolvedValue({});
  mocks.getProviderConnections.mockImplementation(async (filter = {}) => [connection(filter.provider || "nvidia")]);
});

describe("isProviderModelDisabled", () => {
  it("matches the list saved under the provider id", async () => {
    mocks.getDisabledModels.mockResolvedValue({ nvidia: ["moonshotai/kimi-k3"] });
    expect(await isProviderModelDisabled("nvidia", "moonshotai/kimi-k3")).toBe(true);
    expect(await isProviderModelDisabled("nvidia", "moonshotai/kimi-k2")).toBe(false);
  });

  it("matches the list saved under the provider alias, whichever name the request used", async () => {
    mocks.getDisabledModels.mockResolvedValue({ kc: ["some-model"] });
    expect(await isProviderModelDisabled("kilocode", "some-model")).toBe(true);
    expect(await isProviderModelDisabled("kc", "some-model")).toBe(true);
  });

  it("matches a compatible node saved under its prefix", async () => {
    mocks.getProviderNodes.mockResolvedValue([{ id: "openai-compatible-abc", prefix: "mynode" }]);
    mocks.getDisabledModels.mockResolvedValue({ mynode: ["local-model"] });
    expect(await isProviderModelDisabled("openai-compatible-abc", "local-model")).toBe(true);
  });

  it("fails open when the lookup throws", async () => {
    mocks.getDisabledModels.mockRejectedValue(new Error("db unavailable"));
    expect(await isProviderModelDisabled("nvidia", "moonshotai/kimi-k3")).toBe(false);
  });
});

describe("getProviderCredentials rejects a disabled model", () => {
  it("returns a 403 unavailable result without touching the account pool", async () => {
    mocks.getDisabledModels.mockResolvedValue({ nvidia: ["moonshotai/kimi-k3"] });

    const credentials = await getProviderCredentials("nvidia", null, "moonshotai/kimi-k3");

    expect(credentials).toMatchObject({ allRateLimited: true, modelDisabled: true, lastErrorCode: 403 });
    expect(credentials.lastError).toMatch(/nvidia\/moonshotai\/kimi-k3.*disabled/);
    expect(credentials.retryAfter).toBeUndefined();
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("still routes a model that is not disabled", async () => {
    mocks.getDisabledModels.mockResolvedValue({ nvidia: ["some-other-model"] });

    const credentials = await getProviderCredentials("nvidia", null, "moonshotai/kimi-k3");

    expect(credentials?.modelDisabled).toBeUndefined();
    expect(credentials?.apiKey).toBe("key-1");
  });

  it("ignores the list for requests without a model", async () => {
    mocks.getDisabledModels.mockResolvedValue({ nvidia: ["moonshotai/kimi-k3"] });

    const credentials = await getProviderCredentials("nvidia", null, null);

    expect(credentials?.apiKey).toBe("key-1");
  });
});
