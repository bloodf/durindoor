import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
}));

describe("Pollinations no-auth fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
  });

  it("returns a non-null public no-auth credential when no saved connection exists", async () => {
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("pollinations");
    expect(credentials).not.toBeNull();
    expect(credentials.id).toBe("noauth");
    expect(credentials.accessToken).toBe("public");
  });
});
