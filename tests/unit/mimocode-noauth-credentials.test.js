import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));

describe("Mimocode no-auth credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ providerStrategies: {} });
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      proxyPoolId: null,
      vercelRelayUrl: "",
    });
  });

  it("preserves stored Mimocode providerSpecificData on the no-auth path", async () => {
    const accountProxies = [
      { fingerprint: "fp-a", proxy: { type: "http", host: "proxy-a.test", port: 8080 } },
    ];
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "mimocode-conn-1",
        provider: "mimocode",
        name: "Mimocode rotation",
        isActive: true,
        providerSpecificData: {
          fingerprints: ["fp-a", "fp-b"],
          accountProxies,
          proxyPoolId: "pool-1",
        },
      },
    ]);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://pool-proxy.test:8080",
      connectionNoProxy: "localhost",
      proxyPoolId: "pool-1",
      vercelRelayUrl: "",
    });

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("mimocode");

    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: "mimocode", isActive: true });
    expect(credentials.connectionId).toBe("mimocode-conn-1");
    expect(credentials.connectionName).toBe("Mimocode rotation");
    expect(credentials.providerSpecificData).toMatchObject({
      fingerprints: ["fp-a", "fp-b"],
      accountProxies,
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://pool-proxy.test:8080",
      connectionNoProxy: "localhost",
      connectionProxyPoolId: "pool-1",
    });
  });

  it("skips stored Mimocode connections that are model-locked", async () => {
    const lockedConnection = {
      id: "mimocode-locked",
      displayName: "Locked Mimocode",
      providerSpecificData: { fingerprints: ["fp-locked"] },
      "modelLock_mimo-auto": new Date(Date.now() + 60_000).toISOString(),
    };
    const freeConnection = {
      id: "mimocode-free",
      displayName: "Free Mimocode",
      providerSpecificData: { fingerprints: ["fp-free"] },
    };
    mocks.getProviderConnections.mockResolvedValue([lockedConnection, freeConnection]);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({ connectionProxyEnabled: false, connectionProxyUrl: "" });

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("mimocode", null, "mimo-auto");

    expect(credentials.connectionId).toBe("mimocode-free");
    expect(credentials.providerSpecificData.fingerprints).toEqual(["fp-free"]);
  });

  it("falls back to virtual public credentials when no stored Mimocode connections are active", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({
      providerStrategies: { mimocode: { proxyPoolId: "pool-public" } },
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://public-proxy.test:8080",
      connectionNoProxy: "",
      proxyPoolId: "pool-public",
      vercelRelayUrl: "",
    });

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("mimocode");

    expect(credentials.connectionId).toBe("noauth");
    expect(credentials.connectionName).toBe("Public");
    expect(credentials.providerSpecificData).toMatchObject({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://public-proxy.test:8080",
      connectionProxyPoolId: "pool-public",
    });
  });
});
