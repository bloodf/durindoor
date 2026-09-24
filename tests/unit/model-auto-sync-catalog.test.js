import { describe, expect, it } from "vitest";
import {
  classifyModelKind,
  effectiveSyncedModels,
  extractApiCapabilities,
  findPrunedReferences,
  getModelAutoSyncIntervalHours,
  isModelAutoSyncEnabled,
  isSyncDue,
  markSyncFailure,
  mergeSyncedCatalog,
  normalizeSyncedModels,
  validateModelAutoSyncSettingsPatch
} from "../../src/lib/modelAutoSync/catalog.js";

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
      capabilities: { contextWindow: 1_000_000, maxOutput: 128_000, vision: true, pdf: true, reasoning: true }
    });
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
    expect(row.capabilities).toEqual({ contextWindow: 2_097_152, maxOutput: 65_536, reasoning: true });
  });

  it("reads GitHub Copilot limits and supports", () => {
    expect(extractApiCapabilities({
      id: "gpt-6",
      capabilities: { type: "chat", limits: { max_context_window_tokens: 400_000, max_output_tokens: 64_000 }, supports: { vision: true, tool_calls: true } }
    })).toEqual({ contextWindow: 400_000, maxOutput: 64_000, vision: true, tools: true });
  });

  it("reads Codex context_window and leaves ids without metadata bare", () => {
    expect(extractApiCapabilities({ slug: "gpt-6-sol", context_window: 272_000 })).toEqual({ contextWindow: 272_000 });
    expect(normalizeSyncedModels([{ id: "grok-5" }])[0]).toEqual({ id: "grok-5", name: "grok-5", kind: "llm" });
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
