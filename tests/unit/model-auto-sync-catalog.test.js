import { describe, expect, it } from "vitest";
import {
  classifyModelKind,
  effectiveSyncedModels,
  findPrunedReferences,
  getModelAutoSyncIntervalHours,
  isModelAutoSyncEnabled,
  isSyncDue,
  markSyncFailure,
  materializeSyncedModel,
  mergeSyncedCatalog,
  normalizeSyncedModels,
  validateModelAutoSyncSettingsPatch
} from "../../src/lib/modelAutoSync/catalog.js";
import { extractApiCapabilities } from "../../open-sse/services/modelMetadata.js";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("model auto-sync: chat / non-chat filtering", () => {
  it.each([
    ["gpt-6", "llm"],
    ["gpt-4o-audio-preview", "llm"],
    ["text-embedding-3-large", "embedding"],
    ["tts-1-hd", "tts"],
    ["gpt-4o-mini-tts", "tts"],
    ["whisper-1", "stt"],
    ["gpt-4o-transcribe", "stt"],
    ["dall-e-3", "image"],
    ["gpt-image-2", "image"],
    ["grok-2-image-1212", "image"],
    ["imagen-4.0-generate-001", "image"],
    ["veo-3.0-generate-001", "video"],
    ["omni-moderation-latest", null],
    ["gpt-realtime", null]
  ])("%s -> %s", (id, kind) => {
    expect(classifyModelKind(id)).toBe(kind);
  });

  it("uses Gemini generation methods for ids the patterns do not settle", () => {
    expect(classifyModelKind("gemini-3.9-pro", { supportedGenerationMethods: ["generateContent", "countTokens"] })).toBe("llm");
    expect(classifyModelKind("text-multilingual-002", { supportedGenerationMethods: ["embedContent"] })).toBe("embedding");
    expect(classifyModelKind("aqa", { supportedGenerationMethods: ["generateAnswer"] })).toBeNull();
  });

  it("drops non-routable models and de-duplicates during normalization", () => {
    const rows = normalizeSyncedModels([
      { id: "gpt-6" },
      { id: "gpt-6" },
      { id: "omni-moderation-latest" },
      { id: "text-embedding-3-small" },
      "plain-string-id",
      null
    ]);
    expect(rows.map((m) => [m.id, m.kind])).toEqual([
      ["gpt-6", "llm"],
      ["text-embedding-3-small", "embedding"],
      ["plain-string-id", "llm"]
    ]);
  });

  it("skips Codex review variants the fetcher synthesizes", () => {
    const rows = normalizeSyncedModels([
      { id: "gpt-6-sol", slug: "gpt-6-sol" },
      { id: "gpt-6-sol-review", upstreamModelId: "gpt-6-sol", quotaFamily: "review" },
      { id: "codex-auto-review", quotaFamily: "review" }
    ]);
    expect(rows.map((m) => m.id)).toEqual(["gpt-6-sol", "codex-auto-review"]);
  });
});

describe("model auto-sync: capabilities from provider APIs", () => {
  it("reads Anthropic limits and capability flags", () => {
    const [row] = normalizeSyncedModels([{
      id: "claude-opus-6",
      type: "model",
      display_name: "Claude Opus 6",
      max_input_tokens: 1_000_000,
      max_tokens: 128_000,
      capabilities: { image_input: { supported: true }, pdf_input: { supported: true }, thinking: { supported: true } }
    }]);
    expect(row).toEqual({
      id: "claude-opus-6",
      name: "Claude Opus 6",
      kind: "llm",
      capabilities: { contextWindow: 1_000_000, maxInput: 1_000_000, maxOutput: 128_000, vision: true, pdf: true, reasoning: true }
    });
  });

  it.each([
    ["anthropic", { id: "future-native-model", max_input_tokens: 1_000_000, max_tokens: 128_000 }, 1_000_000, 128_000],
    ["gemini", { id: "future-native-model", inputTokenLimit: 2_097_152, outputTokenLimit: 65_536 }, 2_097_152, 65_536],
  ])("retains stripped %s protocol limits through storage and re-materialization", (format, raw, contextWindow, maxOutput) => {
    const declaration = {
      ...raw,
      limits: { max_input_tokens: contextWindow, max_output_tokens: maxOutput },
      capabilities: { tools: false, defaultOutput: 4096 },
    };
    const [row] = normalizeSyncedModels([declaration], [], { format });
    const expected = { contextWindow, maxInput: contextWindow, maxOutput, defaultOutput: 4096, tools: false };
    expect(row.capabilities).toEqual(expected);
    const stored = mergeSyncedCatalog(null, [row], { now: NOW });
    const shared = { providers: { [format]: { [row.id]: { contextWindow: 8_000_000, tools: true } } } };
    const [first] = effectiveSyncedModels(stored, [], format, shared);
    const second = materializeSyncedModel(format, first, shared);
    expect(first.capabilities).toEqual(expected);
    expect(second.capabilities).toEqual(expected);
    expect(second.discoveredCapabilities).toEqual(expected);
    expect(first.metadataSources).toMatchObject({ provider: true, providerFetchedAt: stored.syncedAt, shared: true });
    expect(stored.models[0].capabilities).toEqual(expected);
    expect(declaration).not.toHaveProperty("contextWindow");
  });

  it("reads Gemini token limits, thinking and strips the models/ prefix", () => {
    const [row] = normalizeSyncedModels([{
      name: "models/gemini-3.9-pro",
      displayName: "Gemini 3.9 Pro",
      inputTokenLimit: 2_097_152,
      outputTokenLimit: 65_536,
      thinking: true,
      supportedGenerationMethods: ["generateContent"]
    }]);
    expect(row.id).toBe("gemini-3.9-pro");
    expect(row.name).toBe("Gemini 3.9 Pro");
    expect(row.capabilities).toEqual({ contextWindow: 2_097_152, maxInput: 2_097_152, maxOutput: 65_536, reasoning: true });
  });

  it("does not invent native context for generic independent limits or join separate sources", () => {
    const [row] = normalizeSyncedModels([{
      id: "future-model",
      limits: { max_input_tokens: 922000 },
      meta: { max_output_tokens: 128000 },
      capabilities: { defaultOutput: 4096, tools: false },
    }]);
    const expected = { maxInput: 922000, maxOutput: 128000, defaultOutput: 4096, tools: false };
    expect(row.capabilities).toEqual(expected);
    const stored = mergeSyncedCatalog(null, [row], { now: NOW });
    const [model] = effectiveSyncedModels(stored, [], "openai");
    expect(model.capabilities).toEqual(expected);
    expect(model.discoveredCapabilities).toEqual(expected);
    expect(normalizeSyncedModels([{
      id: "independent-model", inputTokenLimit: 2097152, outputTokenLimit: 65536,
    }])[0].capabilities).toEqual({ maxInput: 2097152, maxOutput: 65536 });
  });

  it("preserves generic explicit nested additive pairs but never adds native output budgets", () => {
    const pair = { max_input_tokens: 922000, max_output_tokens: 128000 };
    expect(normalizeSyncedModels([{ id: "future-model", capabilities: { limits: pair } }])[0].capabilities)
      .toEqual({ contextWindow: 1050000, maxInput: 922000, maxOutput: 128000 });
    const native = {
      name: "models/gemini-future", inputTokenLimit: 2097152, outputTokenLimit: 65536,
      supportedGenerationMethods: ["generateContent"],
      limits: { max_input_tokens: 2097152, max_output_tokens: 65536 },
    };
    expect(extractApiCapabilities(native)).toEqual({ contextWindow: 2097152, maxInput: 2097152, maxOutput: 65536 });
    expect(extractApiCapabilities(native, { format: "generic" }))
      .toEqual({ contextWindow: 2162688, maxInput: 2097152, maxOutput: 65536 });
  });

  it("keeps explicit native totals authoritative and generation settings out of capacity", () => {
    expect(extractApiCapabilities({
      inputTokenLimit: 2097152, outputTokenLimit: 65536, context_window: 1000000,
      defaultOutput: 4096, default_generation_settings: { max_tokens: 1024 },
      limits: { max_input_tokens: 2097152, max_output_tokens: 65536 },
    }, { format: "gemini" })).toEqual({
      contextWindow: 1000000, maxInput: 2097152, maxOutput: 65536, defaultOutput: 4096,
    });
    expect(extractApiCapabilities({ default_generation_settings: { max_tokens: 1024 } })).toEqual({});
    expect(extractApiCapabilities({
      inputTokenLimit: "invalid", outputTokenLimit: 65536,
      limits: { max_input_tokens: 2097152, max_output_tokens: 65536 },
    }, { format: "gemini" })).toEqual({ maxInput: 2097152, maxOutput: 65536 });
  });

  it("reads GitHub Copilot limits and supports", () => {
    expect(extractApiCapabilities({
      id: "gpt-6",
      capabilities: { type: "chat", limits: { max_context_window_tokens: 400_000, max_output_tokens: 64_000 }, supports: { vision: true, tool_calls: true } }
    })).toEqual({ contextWindow: 400_000, maxOutput: 64_000, vision: true, tools: true });
  });

  it("leaves ids without metadata bare", () => {
    expect(normalizeSyncedModels([{ id: "grok-5" }])[0]).toEqual({ id: "grok-5", name: "grok-5", kind: "llm" });
  });

  it("preserves a new Codex model's image input, served window and effort contract", () => {
    const [row] = normalizeSyncedModels([{
      slug: "codex-new-model",
      context_window: 272000,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
    }]);
    expect(row.capabilities).toMatchObject({
      vision: true,
      imageOutput: false, audioOutput: false, videoOutput: false,
      contextWindow: 272000, reasoning: true,
      thinkingEfforts: ["low", "high"], thinkingCanDisable: false,
    });
    expect(row.capabilities.maxOutput).toBeUndefined();
  });

  it("honors explicit text-only flags instead of promoting every discovered model to vision", () => {
    expect(extractApiCapabilities({
      input_modalities: ["text"],
      capabilities: { tools: false, structuredOutput: true, promptCaching: true },
    })).toMatchObject({ vision: false, tools: false, structuredOutput: true, promptCaching: true });
  });
});

describe("model auto-sync: re-materialized specifications", () => {
  const snapshot = (models) => ({ syncedAt: new Date(NOW).toISOString(), models });

  it("enriches only the available provider-scoped roster and preserves explicit false", () => {
    const models = normalizeSyncedModels([{ id: "future-model", capabilities: { vision: false, tools: false } }]);
    const stored = mergeSyncedCatalog(null, models, { now: NOW });
    const shared = {
      source: "https://models.dev/api.json", fetchedAt: NOW,
      providers: {
        openai: {
          "future-model": { contextWindow: 512000, maxOutput: 128000, vision: true, tools: true, headers: { Authorization: "never-import" }, transport: { baseUrl: "https://untrusted.example" } },
          "unavailable-model": { contextWindow: 1050000 },
        },
        xai: { "future-model": { contextWindow: 96000, vision: true } },
      },
    };
    const [model] = effectiveSyncedModels(stored, [], "openai", shared);
    expect(model.capabilities).toEqual({ contextWindow: 512000, maxOutput: 128000, vision: false, tools: false });
    expect(effectiveSyncedModels(stored, [], "openai", shared).map((row) => row.id)).toEqual(["future-model"]);
    expect(stored.models).toEqual([{ id: "future-model", name: "future-model", kind: "llm", capabilities: { vision: false, tools: false } }]);
    expect(model.metadataSources).toMatchObject({ provider: true, providerFetchedAt: stored.syncedAt, shared: true, sharedSource: shared.source, sharedFetchedAt: NOW });
  });

  it("keeps provider declarations separate so a newer shared snapshot is not frozen by an old enriched row", () => {
    const raw = normalizeSyncedModels([{ id: "future-model", capabilities: { vision: false } }])[0];
    const first = materializeSyncedModel("openai", raw, { providers: { openai: { "future-model": { contextWindow: 512000, maxOutput: 64000, tools: true } } } });
    const second = materializeSyncedModel("openai", first, { providers: { openai: { "future-model": { contextWindow: 1048576, maxOutput: 1048576, tools: false } } } });
    expect(second.capabilities).toEqual({ contextWindow: 1048576, maxOutput: 1048576, tools: false, vision: false });
    expect(second.discoveredCapabilities).toEqual({ vision: false });
    expect(raw.capabilities).toEqual({ vision: false });
  });

  it("rebuilds legacy mixed rows instead of treating old compatibility defaults as discovery", () => {
    const [model] = effectiveSyncedModels(snapshot([{
      id: "future-model", kind: "llm",
      capabilities: { contextWindow: 200000, maxOutput: 64000, vision: false, tools: true },
      metadataSources: { catalog: "default", provider: false, shared: true },
    }]), [], "openai", { providers: { openai: { "future-model": { contextWindow: 800000, vision: true } } } });
    expect(model.capabilities).toEqual({ contextWindow: 800000, vision: true });
    expect(model.metadataSources.provider).toBe(false);
    expect(model.metadataSources.sharedSource).toBeUndefined();
    expect(model.metadataSources.sharedFetchedAt).toBeUndefined();
  });

  it.each(["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6.1-sol"])("repairs old Codex compaction limits for %s without erasing explicit flags", (id) => {
    const [model] = effectiveSyncedModels(snapshot([{
      id, kind: "llm", capabilities: { contextWindow: 272000, maxOutput: 64000, vision: false, tools: false },
    }]), [], "codex", { providers: { codex: { [id]: { contextWindow: 272000, maxOutput: 64000 } } } });
    expect(model.capabilities).toMatchObject({ contextWindow: 1050000, maxOutput: 128000, maxInput: 922000, vision: false, tools: false });
  });

  it("does not turn a shared output default into a curated MiniMax output ceiling", () => {
    const model = materializeSyncedModel("minimax", { id: "MiniMax-M3.1-Flash-Preview", kind: "llm" }, {
      providers: { minimax: { "MiniMax-M3.1-Flash-Preview": { contextWindow: 200000, maxOutput: 64000 } } },
    });
    expect(model.capabilities).toMatchObject({ contextWindow: 1000000, maxOutput: null });
  });

  it("resolves provider and model aliases only within their canonical provider", () => {
    const shared = {
      providers: {
        "kimi-coding": { k3: { contextWindow: 1048576, tools: false } },
        kimi: { k3: { contextWindow: 96000 } },
      },
      modelMetadata: { "kimi-coding": { k3: { source: "https://models.dev/api.json", fetchedAt: NOW - HOUR } } },
      fetchedAt: NOW,
    };
    const canonical = materializeSyncedModel("kimi-coding", { id: "k3", kind: "llm" }, shared);
    const alias = materializeSyncedModel("kmc", { id: "k3[1m]", kind: "llm" }, shared);
    expect(alias.id).toBe("k3[1m]");
    expect(alias.capabilities).toEqual(canonical.capabilities);
    expect(alias.capabilities.contextWindow).toBe(1048576);
    expect(alias.metadataSources).toMatchObject({ shared: true, sharedSource: "https://models.dev/api.json", sharedFetchedAt: NOW - HOUR });
  });

  it("leaves unknown capabilities unknown and empty modalities do not erase shared vision", () => {
    const [empty] = normalizeSyncedModels([{ id: "future-model", input_modalities: [], output_modalities: [] }]);
    expect(materializeSyncedModel("openai", empty).capabilities).toEqual({});
    expect(materializeSyncedModel("openai", empty, { providers: { openai: { "future-model": { vision: true } } } }).capabilities).toEqual({ vision: true });
  });

  it("treats a cache containing only invalid roster rows as unavailable instead of wiping registry availability", () => {
    expect(effectiveSyncedModels(snapshot([{ id: "" }, { id: " " }, null, "future-model"]), [{ id: "registered-model" }], "openai")).toBeNull();
    const [model] = effectiveSyncedModels({ syncedAt: "invalid-time", models: [{ id: "future-model", capabilities: { vision: false } }] }, [], "openai");
    expect(model.metadataSources.provider).toBe(true);
    expect(model.metadataSources.providerFetchedAt).toBeUndefined();
  });

  it("never advertises a registry transport default as supported model capacity", () => {
    const model = materializeSyncedModel("dgrid", { id: "dgridai/free", kind: "llm" });
    expect(model.capabilities).toEqual({});
    expect(model.metadataSources.catalogSource).toBeNull();
    expect(model.metadataSources.catalog).toBe("default");
  });

  it("retains explicit model-scoped registry capacities and flags without compatibility floors", () => {
    const model = materializeSyncedModel("clova-studio", { id: "HCX-007", kind: "llm" });
    expect(model.capabilities).toMatchObject({ contextWindow: 128000, maxOutput: 32768, reasoning: true });
    expect(model.capabilities.tools).toBeUndefined();
    expect(model.metadataSources.provider).toBe(false);
  });

  it("retains a supported whole-window ceiling independently of the output default", () => {
    const [raw] = normalizeSyncedModels([{
      id: "future-model", capabilities: { contextWindow: 1048576, maxOutput: 1048576, defaultOutput: 131072 },
    }]);
    const model = materializeSyncedModel("openai", raw);
    expect(model.capabilities).toEqual({ contextWindow: 1048576, maxOutput: 1048576, defaultOutput: 131072 });
  });

  it("fills incomplete shared aliases from the canonical entry while keeping alias false and accurate freshness", () => {
    const model = materializeSyncedModel("kmc", { id: "k3[1m]", kind: "llm" }, {
      providers: { "kimi-coding": { k3: { pdf: true, tools: true }, "k3[1m]": { tools: false } } },
      modelMetadata: { "kimi-coding": {
        k3: { source: "https://models.dev/api.json", fetchedAt: NOW - HOUR },
        "k3[1m]": { source: "https://models.dev/api.json", fetchedAt: NOW },
      } },
    });
    expect(model.capabilities.pdf).toBe(true);
    expect(model.capabilities.tools).toBe(false);
    expect(model.metadataSources.sharedFetchedAt).toBe(NOW - HOUR);
    expect(model.metadataSources.sharedEntries).toEqual([
      { modelId: "k3", source: "https://models.dev/api.json", fetchedAt: NOW - HOUR },
      { modelId: "k3[1m]", source: "https://models.dev/api.json", fetchedAt: NOW },
    ]);
  });

  it("retains derived routing metadata through canonical base aliases without granting unrelated variants", () => {
    const staticModels = [
      { id: "base-model", aliases: ["old-base"], kind: "llm" },
      { id: "base-review", upstreamModelId: "base-model", quotaFamily: "review", kind: "llm" },
      { id: "other-review", upstreamModelId: "other-model", quotaFamily: "review", kind: "llm" },
    ];
    const models = effectiveSyncedModels(snapshot(normalizeSyncedModels([{ id: "old-base" }], staticModels)), staticModels, "fixture-provider");
    expect(models.map((model) => model.id)).toEqual(["old-base", "base-review"]);
    expect(models[1]).toMatchObject({ upstreamModelId: "base-model", quotaFamily: "review" });
    const previous = mergeSyncedCatalog(null, normalizeSyncedModels([{ id: "base-model" }], staticModels), { now: NOW, staticModels });
    const refreshed = mergeSyncedCatalog(previous, normalizeSyncedModels([{ id: "old-base" }], staticModels), { now: NOW + HOUR, staticModels });
    expect(refreshed.removedModelIds).not.toContain("base-review");
    expect(models[1].metadataSources.provider).toBe(false);
  });

  it.each(["realtime", "realtimeTranslation", "realtimeTranscription", "documentParsing", "systemone", "imageToText"])("keeps native %s service kind from explicit provider declarations", (kind) => {
    const rows = normalizeSyncedModels([{ id: "future-native-model", kind }]);
    expect(rows[0].kind).toBe(kind);
    expect(materializeSyncedModel("fixture-provider", rows[0]).kind).toBe(kind);
  });
});

describe("model auto-sync: merge and pruning", () => {
  const staticModels = [
    { id: "gpt-5" },
    { id: "gpt-6" },
    { id: "gpt-6-review", upstreamModelId: "gpt-6", quotaFamily: "review" }
  ];

  it("first sync compares against the registry: new and removed ids", () => {
    const entry = mergeSyncedCatalog(null, [{ id: "gpt-6", kind: "llm" }, { id: "gpt-7", kind: "llm" }], { now: NOW, staticModels, connectionId: "c1" });
    expect(entry.syncedAt).toBe(new Date(NOW).toISOString());
    expect(entry.connectionId).toBe("c1");
    expect(entry.newModelIds).toEqual(["gpt-7"]);
    // gpt-6-review stays (its base model is listed); gpt-5 is pruned.
    expect(entry.removedModelIds).toEqual(["gpt-5"]);
    expect(entry.models.map((m) => m.id)).toEqual(["gpt-6", "gpt-7"]);
  });

  it("later syncs compare against the previous synced list", () => {
    const first = mergeSyncedCatalog(null, [{ id: "gpt-6" }, { id: "gpt-7" }], { now: NOW, staticModels });
    const second = mergeSyncedCatalog(first, [{ id: "gpt-7" }, { id: "gpt-8" }], { now: NOW + HOUR, staticModels });
    expect(second.newModelIds).toEqual(["gpt-8"]);
    expect(second.removedModelIds).toEqual(["gpt-6", "gpt-6-review"]);
    expect(second.models.map((m) => m.id)).toEqual(["gpt-7", "gpt-8"]);
  });

  it("the effective list is exactly the synced list plus derived registry variants", () => {
    const entry = mergeSyncedCatalog(null, [{ id: "gpt-6", name: "GPT 6", kind: "llm" }], { now: NOW, staticModels });
    expect(effectiveSyncedModels(entry, staticModels).map((m) => m.id)).toEqual(["gpt-6", "gpt-6-review"]);
  });

  it("no successful catalog means no effective list (registry stays)", () => {
    expect(effectiveSyncedModels(null, staticModels)).toBeNull();
    expect(effectiveSyncedModels(markSyncFailure(null, "401 bad key", NOW), staticModels)).toBeNull();
  });

  it("a failure keeps the previous list and records the error", () => {
    const good = mergeSyncedCatalog(null, [{ id: "gpt-7" }], { now: NOW, staticModels });
    const failed = markSyncFailure(good, "timeout", NOW + HOUR);
    expect(failed.models).toEqual(good.models);
    expect(failed.syncedAt).toBe(good.syncedAt);
    expect(failed.lastAttemptAt).toBe(new Date(NOW + HOUR).toISOString());
    expect(failed.error).toBe("timeout");
    expect(effectiveSyncedModels(failed, staticModels).map((m) => m.id)).toEqual(["gpt-7"]);
  });
});

describe("model auto-sync: pruned references", () => {
  const providers = [{ aliases: ["openai"], ids: new Set(["gpt-7"]), customIds: new Set(["my-finetune"]) }];

  it("flags combo members and aliases whose model is gone, never custom models", () => {
    const result = findPrunedReferences({
      providers,
      combos: [
        { name: "daily", models: ["openai/gpt-5", "openai/gpt-7", "openai/my-finetune", "cc/claude-opus-5"] },
        { name: "clean", models: ["openai/gpt-7"] }
      ],
      modelAliases: { fast: "openai/gpt-5", ok: "openai/gpt-7" }
    });
    expect(result).toEqual({ combos: { daily: ["openai/gpt-5"] }, aliases: { fast: "openai/gpt-5" } });
  });
});

describe("model auto-sync: settings", () => {
  it("defaults on for the big providers and honours overrides", () => {
    for (const id of ["openai", "anthropic", "claude", "xai", "gemini", "codex", "github"]) {
      expect(isModelAutoSyncEnabled(id, {})).toBe(true);
    }
    expect(isModelAutoSyncEnabled("groq", {})).toBe(false);
    expect(isModelAutoSyncEnabled("groq", { modelAutoSyncProviders: { groq: true } })).toBe(true);
    expect(isModelAutoSyncEnabled("openai", { modelAutoSyncProviders: { openai: false } })).toBe(false);
  });

  it("interval defaults to 24h and 0 turns scheduling off", () => {
    expect(getModelAutoSyncIntervalHours({})).toBe(24);
    expect(getModelAutoSyncIntervalHours({ modelAutoSyncIntervalHours: 0 })).toBe(0);
    expect(getModelAutoSyncIntervalHours({ modelAutoSyncIntervalHours: -1 })).toBe(24);
    expect(isSyncDue(null, 24, NOW)).toBe(true);
    expect(isSyncDue({ lastAttemptAt: new Date(NOW - 2 * HOUR).toISOString() }, 24, NOW)).toBe(false);
    expect(isSyncDue({ lastAttemptAt: new Date(NOW - 25 * HOUR).toISOString() }, 24, NOW)).toBe(true);
    expect(isSyncDue(null, 0, NOW)).toBe(false);
  });

  it("validates the settings PATCH keys", () => {
    expect(validateModelAutoSyncSettingsPatch({ modelAutoSyncIntervalHours: 12 })).toBeNull();
    expect(validateModelAutoSyncSettingsPatch({ modelAutoSyncIntervalHours: 0 })).toBeNull();
    expect(validateModelAutoSyncSettingsPatch({ modelAutoSyncIntervalHours: 1.5 })).toMatch(/Invalid/);
    expect(validateModelAutoSyncSettingsPatch({ modelAutoSyncIntervalHours: 721 })).toMatch(/Invalid/);
    expect(validateModelAutoSyncSettingsPatch({ modelAutoSyncProviders: { openai: false } })).toBeNull();
    expect(validateModelAutoSyncSettingsPatch({ modelAutoSyncProviders: { openai: "no" } })).toMatch(/Invalid/);
    expect(validateModelAutoSyncSettingsPatch({ modelAutoSyncProviders: null })).toMatch(/Invalid/);
    expect(validateModelAutoSyncSettingsPatch({ unrelated: 1 })).toBeNull();
  });
});
