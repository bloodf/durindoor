import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AzureExecutor } from "../../open-sse/executors/azure.js";
import { getAzureDeploymentPool, parseAzureDeploymentNames } from "../../open-sse/providers/azureDeployment.js";

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
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: db.getSettings }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { buildModelsList } = await import("../../src/shared/models/buildModelsList.js");
const executor = new AzureExecutor();

function connection(id, deployment, enabledModels) {
  return {
    id,
    provider: "azure",
    isActive: true,
    apiKey: id,
    providerSpecificData: {
      azureEndpoint: "https://example.openai.azure.com/",
      deployment,
      ...(enabledModels ? { deploymentMode: "pool", enabledModels } : {}),
    },
  };
}

describe("9router #5901 Azure deployment pool routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    db.getProviderConnections.mockResolvedValue([
      connection("legacy", "fixed-deployment"),
      connection("pool-a", "fixed-a", ["assistant-a"]),
      connection("pool-b", "fixed-b", ["assistant-b"]),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects the pool connection advertising the requested deployment and dispatches to its URL", async () => {
    const credentials = await getProviderCredentials("azure", null, "assistant-b");
    expect(credentials.connectionId).toBe("pool-b");
    expect(executor.buildUrl("assistant-b", true, 0, credentials)).toBe(
      "https://example.openai.azure.com/openai/deployments/assistant-b/chat/completions?api-version=2024-10-01-preview",
    );
    expect(await getProviderCredentials("azure", new Set(["pool-b"]), "assistant-b")).toBeNull();
  });

  it("keeps the legacy fixed deployment for ordinary requests", async () => {
    const credentials = await getProviderCredentials("azure", null, "unlisted-model");
    expect(credentials.connectionId).toBe("legacy");
    expect(executor.buildUrl("unlisted-model", false, 0, credentials)).toContain("/deployments/fixed-deployment/");
  });

  it("publishes deployments from every active pool and normalizes comma-separated names", async () => {
    expect(parseAzureDeploymentNames(" assistant-a , assistant-b, assistant-a, ")).toEqual(["assistant-a", "assistant-b"]);
    expect(getAzureDeploymentPool({ deploymentMode: "pool", enabledModels: [" assistant-a ", "", 42] })).toEqual(["assistant-a"]);
    expect(getAzureDeploymentPool({ deployment: "fixed", enabledModels: ["assistant-a"] })).toEqual([]);

    const models = await buildModelsList(["llm"]);
    expect(models.map(({ id }) => id)).toEqual(expect.arrayContaining(["azure/assistant-a", "azure/assistant-b"]));
  });
});
