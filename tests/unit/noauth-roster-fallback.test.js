import { beforeEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: mocks.getProviderConnectionById,
  getApiKeyByKey: mocks.getApiKeyByKey,
  validateApiKey: mocks.validateApiKey,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));
const PUBLIC_NO_AUTH_FALLBACK_ROSTER = new Set([
  "aihorde",
  "auggie",
  "chipotle",
  "duckduckgo-web",
  "mimocode",
  "opencode",
  "pollinations",
  "theoldllm",
]);

const registryNoAuthIds = REGISTRY
  .filter((entry) => entry.noAuth === true)
  .map((entry) => entry.id)
  .filter((id) => !PUBLIC_NO_AUTH_FALLBACK_ROSTER.has(id));

describe("public no-auth fallback is restricted to the canonical roster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getQuotaReservationPressure.mockResolvedValue(null);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });

  it("every non-roster noAuth provider in the registry is listed for negative coverage", () => {
    expect(registryNoAuthIds.length).toBeGreaterThan(0);
  });

  it.each(registryNoAuthIds)("rejects the public fallback for non-roster noAuth provider %s", async (providerId) => {
    const { providerAllowsPublicNoAuthFallback } = await import("../../src/sse/services/auth.js");
    expect(providerAllowsPublicNoAuthFallback(providerId)).toBe(false);
  });

  it.each(registryNoAuthIds)("getProviderCredentials returns null with no DB writes for non-roster %s", async (providerId) => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials(providerId);

    expect(credentials).toBeNull();
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it.each([...PUBLIC_NO_AUTH_FALLBACK_ROSTER])("admits the public fallback for roster provider %s", async (providerId) => {
    const { providerAllowsPublicNoAuthFallback } = await import("../../src/sse/services/auth.js");
    expect(providerAllowsPublicNoAuthFallback(providerId)).toBe(true);
  });

  it("returns public no-auth credential for mimocode with zero stored rows", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("mimocode");

    expect(credentials).toMatchObject({ id: "noauth", connectionId: "noauth", authType: "none" });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not return public credentials when stored Mimocode rows are excluded", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "mimocode-stored",
      provider: "mimocode",
      providerSpecificData: {},
    }]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("mimocode", new Set(["mimocode-stored"]));

    expect(credentials).toBeNull();
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
