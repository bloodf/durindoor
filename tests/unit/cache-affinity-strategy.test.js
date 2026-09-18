import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getProxyPools: mocks.getProxyPools,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));

const { getProviderCredentials, resetProviderSessionAffinity } = await import("../../src/sse/services/auth.js");

function makeConnection(id, priority) {
  return {
    id,
    provider: "kiro",
    authType: "oauth",
    accessToken: `token-${id}`,
    isActive: true,
    priority,
    providerSpecificData: {},
  };
}

describe('getProviderCredentials with fallbackStrategy "cache-affinity"', () => {
  let connections;

  beforeEach(() => {
    vi.clearAllMocks();
    resetProviderSessionAffinity();
    connections = [
      makeConnection("conn-a", 1),
      makeConnection("conn-b", 2),
      makeConnection("conn-c", 3),
    ];
    mocks.getProviderConnections.mockResolvedValue(connections);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.updateProviderConnection.mockImplementation(async (id, updates) => {
      const row = connections.find((c) => c.id === id);
      if (row) Object.assign(row, updates);
      return row ? { ...row, ...updates } : null;
    });
  });

  it("pins the same conversation to the same account across calls", async () => {
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "cache-affinity", providerStrategies: {} });

    const first = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", { sessionId: "thread-1" });
    const second = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", { sessionId: "thread-1" });

    expect(first.connectionId).toBe(second.connectionId);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      first.connectionId,
      expect.objectContaining({ lastUsedAt: expect.any(String) })
    );
  });

  it("spreads distinct conversations across the pool", async () => {
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "cache-affinity", providerStrategies: {} });

    const picks = new Set();
    for (let i = 0; i < 20; i++) {
      const result = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", { sessionId: `thread-${i}` });
      picks.add(result.connectionId);
    }

    expect(picks.size).toBeGreaterThan(1);
  });

  it("moves to the next-ranked account when the pinned one is excluded (retry)", async () => {
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "cache-affinity", providerStrategies: {} });

    const pinned = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", { sessionId: "thread-2" });
    const retry = await getProviderCredentials("kiro", new Set([pinned.connectionId]), "claude-sonnet-4.5", { sessionId: "thread-2" });

    expect(retry.connectionId).not.toBe(pinned.connectionId);
    expect(["conn-a", "conn-b", "conn-c"]).toContain(retry.connectionId);
  });

  it("honors a per-provider override even when the global strategy differs", async () => {
    mocks.getSettings.mockResolvedValue({
      fallbackStrategy: "fill-first",
      providerStrategies: { kiro: { fallbackStrategy: "cache-affinity" } },
    });

    const first = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", { sessionId: "thread-3" });
    const second = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", { sessionId: "thread-3" });

    expect(first.connectionId).toBe(second.connectionId);
  });

  it("falls back to fill-first when the request carries no sessionId", async () => {
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "cache-affinity", providerStrategies: {} });

    const result = await getProviderCredentials("kiro", null, "claude-sonnet-4.5");

    expect(result.connectionId).toBe("conn-a");
  });
});
