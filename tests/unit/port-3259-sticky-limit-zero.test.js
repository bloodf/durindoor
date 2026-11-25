import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn().mockResolvedValue([]),
  validateApiKey: vi.fn(),
  getQuotaFetchState: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const connection = (id, priority, extra = {}) => ({
  id, provider: "codex", authType: "oauth", accessToken: `token-${id}`, refreshToken: `refresh-${id}`,
  priority, isActive: true, updatedAt: new Date(NOW - 60_000).toISOString(), ...extra,
});

async function select(override) {
  mocks.getSettings.mockResolvedValue({
    fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3,
    providerStrategies: { codex: { fallbackStrategy: "round-robin", ...override } },
  });
  return (await getProviderCredentials("codex", null, "gpt-5.4", { now: NOW, quotaSnapshotsLoader: async () => [] })).connectionId;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateProviderConnection.mockImplementation(async () => null);
  mocks.getProviderConnections.mockResolvedValue([
    connection("one", 1, { lastUsedAt: new Date(NOW - 1000).toISOString(), consecutiveUseCount: 50 }),
    connection("two", 2),
  ]);
});

describe("port(upstream): #3259 - an explicit sticky limit of 0 is honoured", () => {
  it("stays on the current account instead of using the global limit", async () => {
    expect(await select({ stickyRoundRobinLimit: 0 })).toBe("one");
  });

  it("still rotates when the override is absent", async () => {
    expect(await select({})).toBe("two");
  });
});
