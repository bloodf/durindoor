import { describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] }));
vi.mock("@/lib/localDb", () => ({
  getCustomModels: async () => db.rows,
  getProviderConnections: async () => [], getProviderNodes: async () => [],
  getCombos: async () => [], getComboForModel: async () => null,
  getComboByName: async () => null, getModelAliases: async () => ({}),
  getSyncedModelCatalog: async () => null, getSyncedModelCatalogs: async () => ({}),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: async () => ({}) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: async () => ({}) }));
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({ getSharedModelMetadata: async () => null }));
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";
import { loadCustomCapabilities } from "../../src/sse/services/model.js";
import { reorderByCapabilities } from "../../open-sse/services/combo.js";
import { aggregateComboCapabilities } from "../../open-sse/providers/capabilities.js";

describe("Cursor operator vision overrides", () => {
  it.each(["cursor", "cu"])("keeps %s metadata and actual routing non-vision while preserving other overrides", async (providerAlias) => {
    db.rows = [
      { id: "operator-model", providerAlias, capabilities: { vision: true, tools: false } },
      { id: "operator-model", providerAlias: "openai", capabilities: { vision: true, tools: false } },
    ];
    const models = await buildModelsList(["llm"]);
    expect(models.find((row) => row.id === `${providerAlias}/operator-model`).capabilities).toMatchObject({ vision: false, tools: false });
    expect(models.find((row) => row.id === "openai/operator-model").capabilities).toMatchObject({ vision: true, tools: false });
    const cursor = await loadCustomCapabilities(providerAlias, "operator-model", providerAlias);
    const other = await loadCustomCapabilities("openai", "operator-model", "openai");
    expect(cursor).toMatchObject({ vision: false, tools: false });
    expect(other).toMatchObject({ vision: true, tools: false });
    const members = [`${providerAlias}/operator-model`, "openai/operator-model"];
    const caps = new Map([[members[0], cursor], [members[1], other]]);
    expect(reorderByCapabilities(members, new Set(["vision"]), caps)).toEqual([members[1], members[0]]);
    expect(aggregateComboCapabilities([members[0]], null, null, 0, new Map([[members[0], { vision: true }]]))).toMatchObject({ vision: false });
  });
});
