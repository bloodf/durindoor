import { beforeEach, describe, expect, it, vi } from "vitest";

// OmniRoute #6889 (fixes #6557) — the `auto` combo's no-auth candidate pool
// must honor a disabled provider connection's OWN `isActive=false` (the toggle
// on the main Providers grid card), not just the separate global
// `blockedProviders` setting.
//
// Tri-state contract exercised through the REAL catalog builder
// (getAutoComboCatalog → applyNoAuthAutoComboGate) so the DB filter, the
// registry no-auth config, and the connection-id → catalog-alias mapping are
// all verified, not just the pure helper:
//   1. zero connection rows          → no-auth provider INCLUDED by default
//   2. only an isActive=false row    → provider EXCLUDED (the #6557 fix)
//   3. an active provider-account row (even beside a separate inactive row)
//                                    → provider INCLUDED (active wins)

const mocks = vi.hoisted(() => ({
  getComboForModel: vi.fn(),
  getComboByName: vi.fn(),
  getModelAliases: vi.fn(),
  getProviderNodes: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ disabledFreeProviders: [] }),
}));

vi.mock("@/lib/localDb", () => ({
  getComboForModel: mocks.getComboForModel,
  getComboByName: mocks.getComboByName,
  getModelAliases: mocks.getModelAliases,
  getProviderNodes: mocks.getProviderNodes,
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
}));

async function loadService() {
  return import("../../src/sse/services/model.js");
}

// mimocode is a static no-auth provider (registry noAuth===true, category free)
// whose PROVIDER_MODELS catalog key is its ALIAS `mcode`, and whose only model
// `mimo-auto` is mimo-family-detectable — so `auto/mimo` materializes it.
const MIMO_MEMBER = "mcode/mimo-auto";

describe("auto-combo no-auth isActive gate (#6889 / #6557)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getProviderConnections.mockResolvedValue([]);
  });

  it("zero connection rows: no-auth provider is in the default pool", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const { getAutoComboCatalog, getComboModels } = await loadService();

    const catalog = await getAutoComboCatalog();
    expect(catalog.mcode, "zero-row default seeds the no-auth catalog key").toBeDefined();

    const pool = await getComboModels("auto/mimo", false);
    expect(pool).toContain(MIMO_MEMBER);
  });

  it("only an isActive=false row: provider is removed from the pool", async () => {
    // Simulates exactly what the main Providers grid toggle persists:
    // PUT /api/providers/:id { isActive:false } → provider_connections row.
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "mimocode", isActive: false },
    ]);
    const { getAutoComboCatalog, getComboModels } = await loadService();

    const catalog = await getAutoComboCatalog();
    expect(catalog.mcode, "disabled via its own connection row must not be seeded").toBeUndefined();

    const pool = await getComboModels("auto/mimo", false);
    expect(pool).not.toContain(MIMO_MEMBER);
  });

  it("active provider-account row wins over a separate inactive row", async () => {
    // Same provider has BOTH a disabled account and an enabled account: the
    // enabled provider-account path keeps the provider in rotation.
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "mimocode", isActive: false },
      { provider: "mimocode", isActive: true },
    ]);
    const { getAutoComboCatalog, getComboModels } = await loadService();

    const catalog = await getAutoComboCatalog();
    expect(catalog.mcode, "an active row re-includes the provider").toBeDefined();

    const pool = await getComboModels("auto/mimo", false);
    expect(pool).toContain(MIMO_MEMBER);
  });

  it("config roster: NOAUTH_PROVIDERS matches the upstream-equivalent chat set", async () => {
    // Guards registry drift: the seeded no-auth roster must stay exactly the
    // upstream-curated chat set (veoaifree-web is video-only and absent on
    // dev). Adding/removing a marker flips this test so a silent pool change
    // cannot slip through.
    const { NOAUTH_PROVIDERS } = await import("../../open-sse/config/providers.js");
    expect(Object.keys(NOAUTH_PROVIDERS).sort()).toEqual([
      "auggie",
      "chipotle",
      "duckduckgo-web",
      "mimocode",
      "opencode",
      "theoldllm",
    ]);
  });

  it("preserve enabled/provider-account behavior: active glm included, inactive glm excluded", async () => {
    // Credentialed providers keep the pre-existing rule: only ACTIVE rows seat
    // a provider in the auto-combo catalog. The no-auth gate must not disturb it.
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "glm", isActive: true },
      { provider: "minimax", isActive: false },
    ]);
    const { getAutoComboCatalog } = await loadService();
    const catalog = await getAutoComboCatalog();
    expect(catalog.glm, "active credentialed connection still included").toBeDefined();
    expect(catalog.minimax, "inactive credentialed connection still excluded").toBeUndefined();
  });
});
