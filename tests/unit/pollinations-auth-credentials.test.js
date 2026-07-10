import { beforeEach, describe, expect, it, vi } from "vitest";
import { PollinationsExecutor } from "../../open-sse/executors/pollinations.js";

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
    expect(new PollinationsExecutor().buildHeaders(credentials).Authorization).toBeUndefined();
  });

  it("never forwards public no-auth placeholders as bearer credentials", () => {
    const executor = new PollinationsExecutor();

    for (const credentials of [
      { apiKey: "public" },
      { accessToken: "public" },
      { apiKey: "sk_durindoor" },
      { id: "noauth", apiKey: "must-not-leak" },
      { connectionId: "noauth", accessToken: "must-not-leak" },
    ]) {
      expect(executor.buildHeaders(credentials).Authorization).toBeUndefined();
    }
    expect(executor.buildHeaders({ apiKey: "real-premium-key" }).Authorization).toBe(
      "Bearer real-premium-key",
    );
  });

  it("falls back to the synthetic public no-auth credential when the only saved connection is excluded", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "pollinations", apiKey: "real-premium-key", isActive: true },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("pollinations", new Set(["conn-1"]));

    expect(credentials).toMatchObject({ id: "noauth", accessToken: "public" });
  });

  it("stops retrying after both the real key and public fallback were excluded", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "pollinations", apiKey: "real-premium-key", isActive: true },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    await expect(
      getProviderCredentials("pollinations", new Set(["conn-1", "noauth"])),
    ).resolves.toBeNull();
  });

  it("does not recreate public credentials when noauth is already excluded", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    await expect(
      getProviderCredentials("pollinations", new Set(["noauth"])),
    ).resolves.toBeNull();
  });
});
