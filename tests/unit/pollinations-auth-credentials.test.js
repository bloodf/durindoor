import { beforeEach, describe, expect, it, vi } from "vitest";

// getProviderCredentials for a `noAuth` free provider (Pollinations) must
// prefer a real saved connection/API key over the synthetic public no-auth
// credential, and only fall back to the synthetic credential when no real
// connection exists or is currently usable. See src/sse/services/auth.js.
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

describe("getProviderCredentials for no-auth providers with an optional real key (Pollinations)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
  });

  it("selects a real saved Pollinations API-key connection over the synthetic no-auth fallback", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "pollinations",
        apiKey: "real-premium-key",
        priority: 0,
        isActive: true,
      },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("pollinations");

    // The real fix: DB connections must actually be read (and preferred)
    // instead of short-circuiting straight to the synthetic no-auth path.
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: "pollinations", isActive: true });
    expect(credentials.id).not.toBe("noauth");
    expect(credentials.apiKey).toBe("real-premium-key");
    expect(credentials.connectionId).toBe("conn-1");
  });

  it("falls back to the synthetic public no-auth credential when no saved connection exists", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("pollinations");

    // Real production no-auth credential shape.
    expect(credentials).toMatchObject({ id: "noauth", accessToken: "public" });
  });

  it("falls back to the synthetic public no-auth credential when the only saved connection is excluded", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "pollinations", apiKey: "real-premium-key", isActive: true },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("pollinations", new Set(["conn-1"]));

    expect(credentials).toMatchObject({ id: "noauth", accessToken: "public" });
  });
});
