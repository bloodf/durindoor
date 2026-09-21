import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Port #4206: a visible-model allowlist (`enabledModelsDb`) restricts what
// /v1/models publishes for a provider. These tests cover the review findings
// fixed on top of that port: allowlist enforcement on keyless live catalogs,
// storage-key resolution that ignores a colliding custom output prefix, and
// alias targets that must not bypass an active allowlist.

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getEnabledModels: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: mocks.getEnabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));

import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

function stubBase({ connections = [], modelAliases = {}, enabledModels = {} } = {}) {
  mocks.getProviderConnections.mockResolvedValue(connections);
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue(modelAliases);
  mocks.getDisabledModels.mockResolvedValue({});
  mocks.getEnabledModels.mockResolvedValue(enabledModels);
  mocks.getSettings.mockResolvedValue({});
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
}

describe("visible-model allowlist enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters a keyless live catalog (addNoAuthProviderModels) by the stored allowlist", async () => {
    stubBase({ enabledModels: { horde: ["allowed-model"] } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "allowed-model" }, { id: "blocked-model" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);

    expect(ids).toContain("horde/allowed-model");
    expect(ids).not.toContain("horde/blocked-model");
  });

  it("resolves the allowlist by the provider's storage alias, not a colliding custom output prefix", async () => {
    // "hcnsec" is itself a registered provider alias. Configuring it as
    // qiniu's custom output prefix must not pull hcnsec's stored allowlist.
    stubBase({
      connections: [{
        id: "conn-qiniu",
        provider: "qiniu",
        apiKey: "qk",
        isActive: true,
        providerSpecificData: { prefix: "hcnsec" },
      }],
      enabledModels: { hcnsec: ["wrong-model"], qiniu: ["right-model"] },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "right-model" }, { id: "wrong-model" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);

    expect(ids).toContain("hcnsec/right-model");
    expect(ids).not.toContain("hcnsec/wrong-model");
  });

  it("does not let a model alias re-expose an id outside an active allowlist", async () => {
    stubBase({
      connections: [{
        id: "conn-qiniu",
        provider: "qiniu",
        apiKey: "qk",
        isActive: true,
        providerSpecificData: {},
      }],
      modelAliases: { sneaky: "qiniu/blocked-model" },
      enabledModels: { qiniu: ["allowed-model"] },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "allowed-model" }, { id: "blocked-model" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);

    expect(ids).toContain("qiniu/allowed-model");
    expect(ids).not.toContain("qiniu/blocked-model");
  });

  it("fails the request instead of silently serving an unrestricted catalog when the allowlist can't be read", async () => {
    stubBase();
    mocks.getEnabledModels.mockRejectedValue(new Error("db unavailable"));

    await expect(buildModelsList([LLM_KIND])).rejects.toThrow("db unavailable");
  });
});
