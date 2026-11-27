import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the two review findings on the 9router #5901 port
// (decolua/9router#5901, commit 2d5c9dc8974 "route Azure requests to
// configured deployment pools"):
//
// 1. (high) src/shared/models/modelListCore.js resolved the enabled models from
//    the first active Azure connection even when it sat outside
//    allowedConnectionIds, so a key scoped to pool-b published pool-a's
//    deployments. It also unioned the pooled deployments over an explicit
//    provider-level allowlist instead of letting that allowlist restrict them.
// 2. (medium) src/sse/services/auth.js applied the deployment-pool filter only
//    in eligibleBeforeRpm, so a pool that cannot serve the requested model could
//    still decide rate-limit and recovery outcomes.
const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getQuotaReservationPressure: vi.fn(async () => new Map()),
  getCachedSharedModelMetadata: vi.fn(async () => null),
  getSyncedModelCatalogs: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
  getProviderConnectionById: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getEnabledModels: vi.fn(async () => ({})),
  getDisabledModels: vi.fn(async () => ({})),
  canSelectConnection: vi.fn(() => true),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: db.getDisabledModels }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: db.getEnabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: db.getSettings }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/lib/routing/connectionRecovery", () => ({ canSelectConnection: db.canSelectConnection }));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { buildModelsList } = await import("../../src/shared/models/buildModelsList.js");

/** Azure rows only: the shared catalog also lists other providers' models. */
function azureIds(models) {
  return models.map(({ id }) => id).filter((id) => id.startsWith("azure/"));
}

function poolConnection(id, deployment, enabledModels) {
  return {
    id,
    provider: "azure",
    isActive: true,
    apiKey: id,
    providerSpecificData: {
      azureEndpoint: "https://example.openai.azure.com/",
      deployment,
      deploymentMode: "pool",
      enabledModels,
    },
  };
}

describe("Azure deployment pool scope (9router #5901 review findings)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    db.getEnabledModels.mockResolvedValue({});
    db.getDisabledModels.mockResolvedValue({});
    db.canSelectConnection.mockImplementation(() => true);
    db.getProviderConnections.mockResolvedValue([
      poolConnection("pool-a", "fixed-a", ["assistant-a"]),
      poolConnection("pool-b", "fixed-b", ["assistant-b"]),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists only the deployments of the pools inside the caller's scope", async () => {
    // The first active Azure connection is pool-a: a key scoped to pool-b must
    // not see pool-a's deployments through the provider's first connection.
    const models = await buildModelsList(["llm"], "block-metadata", { allowedConnectionIds: ["pool-b"] });
    expect(azureIds(models)).toEqual(["azure/assistant-b"]);
  });

  it("restricts pooled deployments to an explicit provider-level allowlist without adding to it", async () => {
    db.getEnabledModels.mockResolvedValue({ azure: ["assistant-a"] });
    const restricted = await buildModelsList(["llm"], "block-metadata", {});
    expect(azureIds(restricted)).toEqual(["azure/assistant-a"]);

    // An allowlist naming a deployment no pool serves publishes nothing.
    db.getEnabledModels.mockResolvedValue({ azure: ["assistant-c"] });
    const unmatched = await buildModelsList(["llm"], "block-metadata", {});
    expect(azureIds(unmatched)).toEqual([]);
  });

  it("still selects the pool that serves the requested model", async () => {
    const credentials = await getProviderCredentials("azure", null, "assistant-b");
    expect(credentials.connectionId).toBe("pool-b");
  });

  it("never lets a pool that cannot serve the model decide the rate-limit outcome", async () => {
    db.getProviderConnections.mockResolvedValue([
      {
        id: "pool-a",
        provider: "azure",
        isActive: true,
        apiKey: "pool-a",
        quotaLockout: { status: "quota", reactivateAt: new Date(Date.now() + 60_000).toISOString() },
        providerSpecificData: {
          azureEndpoint: "https://example.openai.azure.com/",
          deployment: "fixed-a",
          deploymentMode: "pool",
          enabledModels: ["assistant-a"],
        },
      },
      poolConnection("pool-b", "fixed-b", ["assistant-b"]),
    ]);

    // pool-a is locked out, but it does not serve assistant-b. Only pool-b could,
    // and it is excluded from this attempt, so no account is rate limited.
    const result = await getProviderCredentials("azure", new Set(["pool-b"]), "assistant-b");
    expect(result).toBeNull();
  });

  it("never lets a pool that cannot serve the model block the request through recovery", async () => {
    // pool-a is recovering; it does not serve assistant-b, so it must not hold
    // the request hostage while pool-b is ready to serve it.
    db.canSelectConnection.mockImplementation((conn) => conn?.id !== "pool-a");

    const credentials = await getProviderCredentials("azure", null, "assistant-b", {
      preferredConnectionId: "pool-a",
      connectionRecovery: true,
    });
    expect(credentials.connectionId).toBe("pool-b");
  });
});
