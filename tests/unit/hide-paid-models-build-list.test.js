import { beforeEach, describe, expect, it, vi } from "vitest";

// #6495 / F-4 — `hidePaidModels` catalog wiring. `buildModelsList(["llm"])`
// must honor the settings toggle end-to-end: off returns the full catalog
// (paid + free), on drops paid provider rows, keeps curated/explicit free rows
// (registry free markers + curated free-catalog providers), and omits combos
// whose members are all paid while keeping mixed combos (with their paid
// members filtered). This guards the route that feeds `/v1/models`, the
// dashboard picker allowlist, and ACL combo-existence reads.

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: mocks.getSettings,
}));

async function loadBuildModelsList() {
  const mod = await import("../../src/app/api/v1/models/buildModelsList.js");
  return mod.buildModelsList;
}

describe("buildModelsList hidePaidModels wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  const connectedCatalogs = [
    {
      id: "anthropic-test",
      provider: "anthropic",
      apiKey: "test-key",
      providerSpecificData: { enabledModels: ["claude-sonnet-4-20250514"] },
    },
    {
      id: "gemini-test",
      provider: "gemini",
      apiKey: "test-key",
      providerSpecificData: { enabledModels: ["gemini-2.5-pro", "gemini-2.5-flash"] },
    },
  ];

  it("toggle off: returns paid + free models and all combos unchanged", async () => {
    mocks.getSettings.mockResolvedValue({ hidePaidModels: false });
    // Healthy DB exposes only connected catalogs; explicit enabledModels keeps
    // this test focused on paid filtering without invoking live discovery.
    mocks.getProviderConnections.mockResolvedValue(connectedCatalogs);
    mocks.getCombos.mockResolvedValue([
      { name: "mixed-combo", models: ["anthropic/claude-sonnet-4-20250514", "aug/claude-sonnet-4.6"] },
      { name: "all-paid-combo", models: ["anthropic/claude-sonnet-4-20250514"] },
    ]);

    const buildModelsList = await loadBuildModelsList();
    const models = await buildModelsList(["llm"]);
    const ids = new Set(models.map((m) => m.id));

    expect(ids.has("anthropic/claude-sonnet-4-20250514")).toBe(true); // paid present when off
    expect(ids.has("gemini/gemini-2.5-pro")).toBe(true); // paid-only Gemini present when off (guards the on-test false assertion below)
    expect(ids.has("gemini/gemini-2.5-flash")).toBe(true); // curated free Gemini present when off
    expect(ids.has("mixed-combo")).toBe(true);
    expect(ids.has("all-paid-combo")).toBe(true);
  });

  it("toggle on: drops paid provider rows, keeps curated/explicit free, omits all-paid combos", async () => {
    mocks.getSettings.mockResolvedValue({ hidePaidModels: true });
    mocks.getProviderConnections.mockResolvedValue(connectedCatalogs);
    mocks.getCombos.mockResolvedValue([
      { name: "mixed-combo", models: ["anthropic/claude-sonnet-4-20250514", "aug/claude-sonnet-4.6"] },
      { name: "all-paid-combo", models: ["anthropic/claude-sonnet-4-20250514"] },
      { name: "free-combo", models: ["aug/claude-sonnet-4.6"] },
    ]);

    const buildModelsList = await loadBuildModelsList();
    const models = await buildModelsList(["llm"]);
    const ids = new Set(models.map((m) => m.id));

    // Paid provider row hidden.
    expect(ids.has("anthropic/claude-sonnet-4-20250514")).toBe(false);
    // Gemini paid-only row (gemini-2.5-pro, not on the free roster) hidden…
    expect(ids.has("gemini/gemini-2.5-pro")).toBe(false);
    // …while the curated free Gemini row stays — exercises the catalog import
    // path, not just the registry free-marker exemption.
    expect(ids.has("gemini/gemini-2.5-flash")).toBe(true);
    // Free no-auth provider row (auggie) stays.
    expect(ids.has("aug/claude-sonnet-4.6")).toBe(true);
    // All-paid combo dropped; mixed + free combos kept.
    expect(ids.has("all-paid-combo")).toBe(false);
    expect(ids.has("mixed-combo")).toBe(true);
    expect(ids.has("free-combo")).toBe(true);
  });
});
