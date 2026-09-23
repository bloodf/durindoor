import { beforeEach, describe, expect, it, vi } from "vitest";

// /v1/models with model auto-sync: an auto-synced provider lists exactly its
// synced catalog plus custom models; everything else keeps registry behavior.

const liveAnthropic = vi.hoisted(() => vi.fn(async () => null));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSyncedModelCatalogs: vi.fn(async () => ({}))
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => null) }));
vi.mock("open-sse/services/liveModelLimits.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveLiveAnthropicModels: liveAnthropic
}));

import * as localDb from "@/lib/localDb";
import * as enabledModelsDb from "@/lib/enabledModelsDb";
import * as disabledModelsDb from "@/lib/disabledModelsDb";
import * as settingsRepo from "@/lib/db/repos/settingsRepo";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";
import { getModelsByProviderId } from "../../src/shared/constants/models.js";

const REGISTRY_ONLY = getModelsByProviderId("openai").find((m) => !m.type && !m.kind).id;

const openaiCatalog = {
  syncedAt: "2026-09-23T12:00:00.000Z",
  lastAttemptAt: "2026-09-23T12:00:00.000Z",
  error: null,
  newModelIds: ["gpt-9"],
  removedModelIds: [REGISTRY_ONLY],
  models: [
    { id: "gpt-9", name: "GPT 9", kind: "llm", capabilities: { contextWindow: 777_000, maxOutput: 99_000 } },
    { id: "text-embedding-9", name: "text-embedding-9", kind: "embedding" }
  ]
};

function setup({ provider = "openai", catalogs = { openai: openaiCatalog }, settings = {}, custom = [], aliases = {}, enabled = {}, disabled = {} } = {}) {
  localDb.getProviderConnections.mockResolvedValue([
    { id: `${provider}-1`, provider, isActive: true, apiKey: "k", accessToken: "t", providerSpecificData: {} }
  ]);
  localDb.getSyncedModelCatalogs.mockResolvedValue(catalogs);
  localDb.getCustomModels.mockResolvedValue(custom);
  localDb.getModelAliases.mockResolvedValue(aliases);
  enabledModelsDb.getEnabledModels.mockResolvedValue(enabled);
  disabledModelsDb.getDisabledModels.mockResolvedValue(disabled);
  settingsRepo.getSettings.mockResolvedValue(settings);
}

const openaiIds = async (kinds = [LLM_KIND]) =>
(await buildModelsList(kinds)).map((m) => m.id).filter((id) => id.startsWith("openai/"));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildModelsList with auto-synced catalogs", () => {
  it("lists exactly the synced chat models and prunes registry defaults", async () => {
    setup();
    expect(await openaiIds()).toEqual(["openai/gpt-9"]);
  });

  it("carries the API-reported limits onto the entry", async () => {
    setup();
    const entry = (await buildModelsList([LLM_KIND])).find((m) => m.id === "openai/gpt-9");
    expect(entry.context_length).toBe(777_000);
    expect(entry.max_completion_tokens).toBe(99_000);
  });

  it("routes synced non-chat models to their service kind list", async () => {
    setup();
    expect(await openaiIds(["embedding"])).toEqual(["openai/text-embedding-9"]);
  });

  it("never removes user-added custom models", async () => {
    setup({ custom: [{ id: "my-finetune", providerAlias: "openai", kind: "llm" }] });
    expect(await openaiIds()).toEqual(expect.arrayContaining(["openai/gpt-9", "openai/my-finetune"]));
  });

  it("an alias pointing at a pruned model does not re-list it", async () => {
    setup({ aliases: { old: `openai/${REGISTRY_ONLY}` } });
    expect(await openaiIds()).not.toContain(`openai/${REGISTRY_ONLY}`);
  });

  it("respects the visible-model allowlist and the disabled list", async () => {
    setup({ enabled: { openai: ["gpt-9", REGISTRY_ONLY] } });
    expect(await openaiIds()).toEqual(["openai/gpt-9"]);
    setup({ disabled: { openai: ["gpt-9"] } });
    expect(await openaiIds()).toEqual([]);
  });

  it("turning auto-update off restores the registry defaults", async () => {
    setup({ settings: { modelAutoSyncProviders: { openai: false } } });
    const ids = await openaiIds();
    expect(ids).toContain(`openai/${REGISTRY_ONLY}`);
    expect(ids).not.toContain("openai/gpt-9");
  });

  it("without a successful sync the registry stays in effect", async () => {
    setup({ catalogs: { openai: { syncedAt: null, error: "401", models: [] } } });
    expect(await openaiIds()).toContain(`openai/${REGISTRY_ONLY}`);
    setup({ catalogs: {} });
    expect(await openaiIds()).toContain(`openai/${REGISTRY_ONLY}`);
  });

  it("a failing catalog read falls back to the registry", async () => {
    setup();
    localDb.getSyncedModelCatalogs.mockRejectedValue(new Error("db down"));
    expect(await openaiIds()).toContain(`openai/${REGISTRY_ONLY}`);
  });

  it("auto-synced providers skip per-request live discovery", async () => {
    setup({ provider: "claude", catalogs: { claude: { ...openaiCatalog, models: [{ id: "claude-opus-9", kind: "llm" }] } } });
    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id).filter((id) => id.startsWith("cc/"));
    expect(ids).toEqual(["cc/claude-opus-9"]);
    expect(liveAnthropic).not.toHaveBeenCalled();
  });
});
