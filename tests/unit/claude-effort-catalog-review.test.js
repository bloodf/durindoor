// Port of OmniRoute #21347 (DurinDoor #2640): a `<claude-base>-<effort>` ID
// whose base exists only in a provider's synced live catalog must reach the
// provider as the base wire model plus that effort, not as an unknown
// suffixed model. Offline: every DB source is an in-memory fixture.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  catalogs: {},
  customModels: [],
  settings: {},
}));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => ({}),
  getComboForModel: async () => null,
  getCombos: async () => [],
  getProviderNodes: async () => [],
  getProviderConnections: async () => [],
  getCustomModels: async () => db.customModels,
  getSyncedModelCatalog: async (providerId) => db.catalogs[providerId] ?? null,
  getSyncedModelCatalogs: async () => db.catalogs,
  getSettings: async () => db.settings,
}));
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({
  getSharedModelMetadata: async () => null,
}));

import { getModelInfo } from "../../src/sse/services/model.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { catalogEffortIntent } from "../../open-sse/translator/concerns/thinkingUnified.js";

// Live-only GitHub Claude row: absent from the static registry, so nothing but
// the synced catalog can make its effort variants routable.
const LIVE_BASE = "claude-haiku-9.9";

function syncGithub(ids) {
  db.catalogs.github = {
    syncedAt: "2026-11-26T00:00:00.000Z",
    models: ids.map((id) => ({ id, name: id })),
  };
}

beforeEach(() => {
  db.catalogs = {};
  db.customModels = [];
  db.settings = {};
});

describe("Claude effort variants against synced base models", () => {
  it("routes an advertised effort of a live-only base to the base wire model", async () => {
    syncGithub([LIVE_BASE]);
    // The level is one `/v1/models` advertises for that row (thinking_levels).
    expect(getThinkingLevels("github", LIVE_BASE)).toContain("high");

    const info = await getModelInfo(`gh/${LIVE_BASE}-high`);
    expect(info).toEqual({ provider: "github", model: LIVE_BASE, resolvedThinkingEffort: "high" });
    // Full provider id spelling resolves the same way.
    expect(await getModelInfo(`github/${LIVE_BASE}-max`)).toEqual(
      { provider: "github", model: LIVE_BASE, resolvedThinkingEffort: "max" });
  });

  it("keeps a literally synced suffixed ID literal", async () => {
    syncGithub([LIVE_BASE, `${LIVE_BASE}-low`]);
    expect(await getModelInfo(`gh/${LIVE_BASE}-low`)).toEqual({ provider: "github", model: `${LIVE_BASE}-low` });
  });

  it("keeps an operator custom suffixed ID literal", async () => {
    syncGithub([LIVE_BASE]);
    db.customModels = [{ id: `${LIVE_BASE}-medium`, providerAlias: "gh" }];
    expect(await getModelInfo(`gh/${LIVE_BASE}-medium`)).toEqual({ provider: "github", model: `${LIVE_BASE}-medium` });
  });

  it("keeps registry IDs that already encode an effort literal", async () => {
    db.catalogs.antigravity = {
      syncedAt: "2026-11-26T00:00:00.000Z",
      models: [{ id: "claude-opus-5-5" }],
    };
    db.settings = { modelAutoSyncProviders: { antigravity: true } };
    expect(await getModelInfo("ag/claude-opus-5-5-high")).toEqual({ provider: "antigravity", model: "claude-opus-5-5-high" });
  });

  it("does not invent efforts the base does not advertise", async () => {
    syncGithub([LIVE_BASE]);
    expect(getThinkingLevels("github", LIVE_BASE)).not.toContain("minimal");
    expect(await getModelInfo(`gh/${LIVE_BASE}-minimal`)).toEqual({ provider: "github", model: `${LIVE_BASE}-minimal` });
    // `-none` is a valid level but not an effort suffix this resolver accepts.
    expect(await getModelInfo(`gh/${LIVE_BASE}-none`)).toEqual({ provider: "github", model: `${LIVE_BASE}-none` });
  });

  it("requires the base to be in the synced catalog", async () => {
    syncGithub(["claude-other-1"]);
    expect(await getModelInfo(`gh/${LIVE_BASE}-high`)).toEqual({ provider: "github", model: `${LIVE_BASE}-high` });
  });

  it("does nothing when auto-sync is off for the provider", async () => {
    syncGithub([LIVE_BASE]);
    db.settings = { modelAutoSyncProviders: { github: false } };
    expect(await getModelInfo(`gh/${LIVE_BASE}-high`)).toEqual({ provider: "github", model: `${LIVE_BASE}-high` });
  });

  it("leaves non-Claude bases and request-only suffixes alone", async () => {
    syncGithub(["gpt-9.9", LIVE_BASE]);
    expect(await getModelInfo("gh/gpt-9.9-high")).toEqual({ provider: "github", model: "gpt-9.9-high" });
    expect(await getModelInfo(`gh/${LIVE_BASE}(high)`)).toEqual({ provider: "github", model: `${LIVE_BASE}(high)` });
  });
});

describe("catalogEffortIntent", () => {
  it("applies the resolved effort only when the request names no thinking setting", () => {
    expect(catalogEffortIntent({}, "high")).toEqual({ mode: "level", level: "high" });
    expect(catalogEffortIntent({ reasoning_effort: "low" }, "high")).toBeNull();
    expect(catalogEffortIntent({ reasoning: { effort: "medium" } }, "high")).toBeNull();
    expect(catalogEffortIntent({ output_config: { effort: "low" } }, "high")).toBeNull();
    expect(catalogEffortIntent({ thinking: { type: "disabled" } }, "high")).toBeNull();
    expect(catalogEffortIntent({ thinking: { type: "enabled", budget_tokens: 2048 } }, "high")).toBeNull();
    expect(catalogEffortIntent({}, undefined)).toBeNull();
  });
});
