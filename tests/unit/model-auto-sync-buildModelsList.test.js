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
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({ getSharedModelMetadata: vi.fn(async () => null) }));
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
import { getSharedModelMetadata } from "@/lib/modelAutoSync/sharedMetadata.js";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";
import { getModelsByProviderId } from "../../src/shared/constants/models.js";
import { PROVIDER_CAPABILITIES } from "open-sse/providers/capabilities.js";
import { projectDiscoveryMetadata } from "open-sse/services/modelMetadata.js";

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
  getSharedModelMetadata.mockResolvedValue(null);
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

  it("retains discovered metadata when a custom row only disables vision", async () => {
    setup({
      catalogs: { openai: { ...openaiCatalog, models: [{
        id: "gpt-9",
        name: "Discovered GPT 9",
        kind: "llm",
        capabilities: {
          contextWindow: 777_000, maxOutput: 99_000, maxInput: 678_000,
          defaultOutput: 12_000, vision: true, tools: true, reasoning: true,
        },
      }] } },
      custom: [{ id: "gpt-9", providerAlias: "openai", kind: "llm", capabilities: { vision: false } }],
    });
    const entries = (await buildModelsList([LLM_KIND])).filter((m) => m.id === "openai/gpt-9");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "Discovered GPT 9",
      context_length: 777_000,
      max_completion_tokens: 99_000,
      capabilities: {
        contextWindow: 777_000, maxOutput: 99_000, maxInput: 678_000,
        defaultOutput: 12_000, vision: false, tools: true, reasoning: true,
      },
    });
    expect(entries[0].capabilities.customKeys).toEqual(new Set(["vision"]));
    expect(Object.keys(entries[0].capabilities)).not.toContain("customKeys");
  });

  it("keeps explicit operator limits above inherited discovered limits", async () => {
    setup({ custom: [{
      id: "gpt-9", providerAlias: "openai", kind: "llm",
      capabilities: { vision: false, contextWindow: 333_000, maxOutput: 22_000 },
    }] });
    const entry = (await buildModelsList([LLM_KIND])).find((m) => m.id === "openai/gpt-9");
    expect(entry).toMatchObject({
      context_length: 333_000,
      max_completion_tokens: 22_000,
      capabilities: { contextWindow: 333_000, maxOutput: 22_000, vision: false },
    });
  });

  it("scopes duplicate model ids to their provider aliases and custom output prefixes", async () => {
    const id = "scoped-future-model";
    setup({
      catalogs: {
        openai: { ...openaiCatalog, models: [{
          id, kind: "llm", capabilities: { contextWindow: 410_000, maxOutput: 41_000, tools: true, vision: true },
        }] },
        claude: { ...openaiCatalog, models: [{
          id, kind: "llm", capabilities: { contextWindow: 820_000, maxOutput: 82_000, tools: false, vision: true },
        }] },
      },
      custom: [
        { id, providerAlias: "openai", kind: "llm", capabilities: { vision: false } },
        { id, providerAlias: "cc", kind: "llm", capabilities: { vision: false } },
        { id, providerAlias: "private-cc", kind: "llm", capabilities: { vision: false } },
      ],
    });
    localDb.getProviderConnections.mockResolvedValue([
      { id: "openai-1", provider: "openai", isActive: true, apiKey: "k", providerSpecificData: { prefix: "private-oai" } },
      { id: "claude-1", provider: "claude", isActive: true, accessToken: "t", providerSpecificData: { prefix: "private-cc" } },
    ]);
    const entries = await buildModelsList([LLM_KIND]);
    for (const alias of ["openai", "private-oai"]) {
      expect(entries.find((m) => m.id === `${alias}/${id}`)).toMatchObject({
        owned_by: alias, context_length: 410_000, max_completion_tokens: 41_000,
        capabilities: { vision: false, tools: true },
      });
    }
    for (const alias of ["cc", "private-cc"]) {
      expect(entries.find((m) => m.id === `${alias}/${id}`)).toMatchObject({
        owned_by: alias, context_length: 820_000, max_completion_tokens: 82_000,
        capabilities: { vision: false, tools: false },
      });
    }
    expect(liveAnthropic).not.toHaveBeenCalled();
  });

  it("enriches explicit custom ids from shared metadata without granting shared-only ids", async () => {
    setup({ custom: [{
      id: "shared-custom", providerAlias: "openai", kind: "llm", capabilities: { vision: false },
    }] });
    getSharedModelMetadata.mockResolvedValue({
      providers: { openai: {
        "shared-custom": { contextWindow: 456_000, maxOutput: 45_000, defaultOutput: 4_000, vision: true, tools: true },
        "shared-only": { contextWindow: 999_000, maxOutput: 99_000 },
      } },
    });
    const entries = await buildModelsList([LLM_KIND]);
    expect(entries.find((m) => m.id === "openai/shared-custom")).toMatchObject({
      context_length: 456_000, max_completion_tokens: 45_000,
      capabilities: { vision: false, tools: true, defaultOutput: 4_000 },
    });
    expect(entries.some((m) => m.id === "openai/shared-only")).toBe(false);
  });

  it("does not borrow a synced chat sibling's metadata for a custom image row", async () => {
    const id = "scoped-future-model";
    setup({
      catalogs: { openai: { ...openaiCatalog, models: [{
        id, kind: "llm", capabilities: {
          contextWindow: 777_000, maxOutput: 99_000, vision: true, tools: true, reasoning: true,
        },
      }] } },
      custom: [{ id, providerAlias: "openai", kind: "image", capabilities: { vision: false } }],
    });
    const image = (await buildModelsList(["image"])).find((m) => m.id === `openai/${id}`);
    expect(image).toMatchObject({
      kind: "image", capabilities: { vision: false, imageOutput: true, tools: false, reasoning: false },
    });
    expect(image.context_length).toBeUndefined();
    expect(image.max_completion_tokens).toBeUndefined();
    const chat = (await buildModelsList([LLM_KIND])).find((m) => m.id === `openai/${id}`);
    expect(chat).toMatchObject({
      context_length: 777_000, max_completion_tokens: 99_000,
      capabilities: { vision: true, tools: true, reasoning: true },
    });
  });

  it("does not inherit conflicting shared or curated chat metadata into a custom image's public projection", async () => {
    const id = "gpt-6.1-sol";
    expect(PROVIDER_CAPABILITIES.openai[id]).toMatchObject({
      tools: true, reasoning: true, contextWindow: 1_050_000, maxInput: 922_000, maxOutput: 128_000,
    });
    setup({ custom: [{ id, providerAlias: "openai", kind: "image", capabilities: { vision: false } }] });
    getSharedModelMetadata.mockResolvedValue({
      providers: { openai: { [id]: {
        kind: "llm", tools: true, reasoning: true, contextWindow: 654_000,
        maxInput: 600_000, maxOutput: 54_000, defaultOutput: 8_000,
      } } },
    });
    const image = (await buildModelsList(["image"])).find((m) => m.id === `openai/${id}`);
    const publicImage = JSON.parse(JSON.stringify(projectDiscoveryMetadata(image)));
    expect(publicImage).toMatchObject({
      kind: "image", capabilities: { vision: false, imageOutput: true, tools: false, reasoning: false },
    });
    expect(publicImage.context_length).toBeUndefined();
    expect(publicImage.max_completion_tokens).toBeUndefined();
    expect(publicImage.max_model_len).toBeUndefined();
    expect(publicImage.max_output_tokens).toBeUndefined();
    expect(publicImage.limits).toBeUndefined();
    expect(publicImage.output).toEqual(["image"]);
    for (const key of ["contextWindow", "maxInput", "maxOutput", "defaultOutput"]) {
      expect(publicImage.capabilities[key] ?? undefined).toBeUndefined();
    }
    expect(image.capabilities.customKeys).toEqual(new Set(["vision"]));
  });

  it("does not inherit shared-only chat metadata into an unregistered custom image", async () => {
    const id = "shared-chat-collision";
    setup({ custom: [{ id, providerAlias: "openai", kind: "image" }] });
    getSharedModelMetadata.mockResolvedValue({
      providers: { openai: { [id]: {
        kind: "llm", tools: true, reasoning: true, contextWindow: 654_000,
        maxInput: 600_000, maxOutput: 54_000, defaultOutput: 8_000,
      } } },
    });
    const image = (await buildModelsList(["image"])).find((m) => m.id === `openai/${id}`);
    expect(image.capabilities).toMatchObject({ imageOutput: true, tools: false, reasoning: false });
    for (const key of ["contextWindow", "maxInput", "maxOutput", "defaultOutput"]) {
      expect(image.capabilities[key] ?? undefined).toBeUndefined();
    }
  });

  it("retains matching registered image metadata and shared defaults beneath operator caps", async () => {
    const id = "gpt-image-1";
    setup({ custom: [{
      id, providerAlias: "openai", kind: "image", capabilities: { vision: false, maxInput: 24_000 },
    }] });
    getSharedModelMetadata.mockResolvedValue({
      providers: { openai: { [id]: { defaultOutput: 600 } } },
    });
    const image = (await buildModelsList(["image"])).find((m) => m.id === `openai/${id}`);
    expect(image.capabilities).toMatchObject({
      imageOutput: true, tools: false, vision: false, maxInput: 24_000, defaultOutput: 600,
    });
    expect(image.capabilities.customKeys).toEqual(new Set(["vision", "maxInput"]));
  });

  it("preserves explicit same-kind discovered image budgets despite a registered chat identity", async () => {
    const id = "gpt-6.1-sol";
    setup({
      catalogs: { openai: { ...openaiCatalog, models: [{
        id, kind: "image", capabilities: {
          contextWindow: 32_000, maxInput: 24_000, maxOutput: 8_000, defaultOutput: 600,
          vision: true, imageOutput: true, tools: false, reasoning: false,
        },
      }] } },
      custom: [{ id, providerAlias: "openai", kind: "image", capabilities: { vision: false } }],
    });
    const image = (await buildModelsList(["image"])).find((m) => m.id === `openai/${id}`);
    expect(image.capabilities).toMatchObject({
      contextWindow: 32_000, maxInput: 24_000, maxOutput: 8_000, defaultOutput: 600,
      vision: false, imageOutput: true, tools: false, reasoning: false,
    });
  });

  it("preserves legitimate shared embedding context and explicit operator ceilings", async () => {
    const id = "private-embedding-model";
    setup({ custom: [{
      id, providerAlias: "openai", kind: "embedding", capabilities: { maxInput: 6_000 },
    }] });
    getSharedModelMetadata.mockResolvedValue({
      providers: { openai: { [id]: { kind: "embedding", contextWindow: 8_192, maxInput: 8_192 } } },
    });
    const embedding = (await buildModelsList(["embedding"])).find((m) => m.id === `openai/${id}`);
    expect(embedding.capabilities).toMatchObject({
      contextWindow: 8_192, maxInput: 6_000, tools: false, reasoning: false,
    });
    expect(embedding.capabilities.customKeys).toEqual(new Set(["maxInput"]));
  });

  it("does not invent token budgets for unknown custom models", async () => {
    setup({ custom: [{
      id: "unknown-custom", providerAlias: "openai", kind: "llm", capabilities: { vision: false },
    }] });
    const entry = (await buildModelsList([LLM_KIND])).find((m) => m.id === "openai/unknown-custom");
    expect(entry.capabilities.vision).toBe(false);
    expect(entry.context_length).toBeUndefined();
    expect(entry.max_completion_tokens).toBeUndefined();
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
