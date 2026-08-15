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

import { getProviderPluginManifestEntryFromRegistry } from "../../open-sse/config/providerPluginManifest.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("kilo-gateway: auth requirement classification", () => {
  const entry = REGISTRY.find((provider) => provider.id === "kilo-gateway");
  const registryMap = Object.fromEntries(REGISTRY.map((provider) => [provider.id, provider]));

  it("exists in the registry", () => {
    expect(entry).toBeDefined();
  });

  it("declares authType 'optional' in the registry entry", () => {
    expect(entry.authType).toBe("optional");
  });

  it("propagates 'optional' to the plugin manifest auth.type", () => {
    const manifestEntry = getProviderPluginManifestEntryFromRegistry(registryMap, "kilo-gateway");
    expect(manifestEntry.auth.type).toBe("optional");
  });

  it("projects optional auth into runtime provider selection", () => {
    expect(PROVIDERS["kilo-gateway"].authType).toBe("optional");
  });
});

describe("Kilo Gateway optional authentication", () => {
  const expectTokenless = (credentials) => {
    expect(credentials).toMatchObject({ id: "noauth", connectionId: "noauth", authType: "none" });
    expect(credentials).not.toHaveProperty("apiKey");
    expect(credentials).not.toHaveProperty("accessToken");
    expect(getExecutor("kilo-gateway").buildHeaders(credentials)).not.toHaveProperty("Authorization");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockImplementation(async (query) =>
      query?.provider === "kilo-gateway" ? [{ id: "kilo-key", apiKey: "kilo-key", provider: "kilo-gateway", isActive: true }] : []
    );
    mocks.getSettings.mockResolvedValue({});
    mocks.getProxyPools.mockResolvedValue([]);
  });

  it("selects tokenless credential without Authorization when no key exists", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    expectTokenless(await getProviderCredentials("kilo-gateway"));
  });

  it("prefers a saved Kilo key and sends it as Bearer authentication", async () => {
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("kilo-gateway");
    expect(getExecutor("kilo-gateway").buildHeaders(credentials).Authorization).toBe("Bearer kilo-key");
  });

  it("does not make ordinary API-key providers credentialless", async () => {
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    await expect(getProviderCredentials("openai")).resolves.toBeNull();
  });
});
