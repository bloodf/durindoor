import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { normalizeKimchiModel } from "../../open-sse/services/kimchiModels.js";

import {
  clearLiveModelLimitsCache,
  getCachedLiveLimits,
  resolveLiveAnthropicModels,
  resolveLiveOpenAIModels,
} from "../../open-sse/services/liveModelLimits.js";
import { extractLiveModelLimits } from "../../open-sse/services/modelMetadata.js";
import { buildModelsResponse } from "../../src/app/api/v1/models/_shared.js";

it("does not replace global fetch when imported", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    let calls = 0;
    const mock = () => { calls += 1; };
    globalThis.fetch = mock;
    await import("./open-sse/services/liveModelLimits.js");
    if (globalThis.fetch !== mock || calls !== 0) process.exit(1);
  `], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
  });

  expect(result.status, result.stderr).toBe(0);
});

describe("extractLiveModelLimits", () => {
  it("reads documented aliases in limits, meta, then root precedence", () => {
    expect(extractLiveModelLimits({
      context_length: 32_000,
      meta: { context_window: 64_000 },
      limits: { max_input_tokens: 128_000, max_output_tokens: 16_000 },
    })).toEqual({ contextWindow: 144_000, maxInput: 128_000, maxOutput: 16_000 });
  });

  it("rejects non-positive, non-integral, and absurd token limits", () => {
    expect(extractLiveModelLimits({
      context_window: 99_000_000,
      context_length: true,
      max_output_tokens: -1,
      limits: { context_length: 3.5, max_output_tokens: "junk" },
    })).toEqual({});
  });

  it("keeps input-only budgets unknown as total capacity and does not join different sources", () => {
    expect(extractLiveModelLimits({ max_input_tokens: 922_000 })).toEqual({ maxInput: 922_000 });
    expect(extractLiveModelLimits({
      limits: { max_input_tokens: 922_000 },
      meta: { max_output_tokens: 128_000 },
    })).toEqual({ maxInput: 922_000, maxOutput: 128_000 });
  });

  it("does not sum native max_tokens into an input context window", () => {
    const native = { max_input_tokens: 1_000_000, max_tokens: 128_000 };
    expect(extractLiveModelLimits(native)).toEqual({ maxInput: 1_000_000, maxOutput: 128_000 });
    expect(extractLiveModelLimits(native, { format: "anthropic" }))
      .toEqual({ contextWindow: 1_000_000, maxInput: 1_000_000, maxOutput: 128_000 });
    expect(extractLiveModelLimits({ max_input_tokens: 1_000_000 }, { format: "anthropic" }))
      .toEqual({ contextWindow: 1_000_000, maxInput: 1_000_000 });
    expect(extractLiveModelLimits({ max_input_tokens: "invalid", max_tokens: 128_000 }, { format: "anthropic" }))
      .toEqual({ maxOutput: 128_000 });
  });

  it("recognizes native ModelInfo and keeps its one-million-token window", () => {
    const native = { type: "model", max_input_tokens: 1_000_000, max_tokens: 128_000 };
    expect(extractLiveModelLimits(native))
      .toEqual({ contextWindow: 1_000_000, maxInput: 1_000_000, maxOutput: 128_000 });
    expect(extractLiveModelLimits({
      ...native, limits: { max_input_tokens: 1_000_000, max_output_tokens: 128_000 },
      capabilities: { contextWindow: 2_000_000 },
    })).toEqual({ contextWindow: 1_000_000, maxInput: 1_000_000, maxOutput: 128_000 });
    expect(extractLiveModelLimits(native, { format: "generic" }))
      .toEqual({ maxInput: 1_000_000, maxOutput: 128_000 });
    expect(extractLiveModelLimits({ ...native, max_tokens: null }))
      .toEqual({ contextWindow: 1_000_000, maxInput: 1_000_000 });
    expect(extractLiveModelLimits({ ...native, max_input_tokens: null }))
      .toEqual({ maxOutput: 128_000 });
  });

  it("keeps explicit total fields authoritative in native mode without dropping defaults", () => {
    expect(extractLiveModelLimits({
      max_model_len: 1_000_000, max_input_tokens: 900_000, max_tokens: 128_000, defaultOutput: 32_000,
      limits: { max_input_tokens: 950_000, max_output_tokens: 128_000 },
    }, { format: "anthropic" })).toEqual({
      contextWindow: 1_000_000, maxInput: 950_000, maxOutput: 128_000, defaultOutput: 32_000,
    });
  });

  it("prefers maxima over default windows within each source", () => {
    expect(extractLiveModelLimits({
      max_model_len: 2_000_000,
      limits: { max_model_len: 1_050_000, context_length: 272_000 },
      meta: { max_model_len: 512_000 },
    })).toEqual({ contextWindow: 1_050_000 });
  });

  it("retains valid independent ceilings when a pair exceeds the validation bound", () => {
    expect(extractLiveModelLimits({
      limits: { max_input_tokens: 16_777_216, max_output_tokens: 1_048_576 },
      meta: { context_window: 1_048_576 },
    })).toEqual({ contextWindow: 1_048_576, maxInput: 16_777_216, maxOutput: 1_048_576 });
  });

  it("keeps full-window output maxima distinct from generation defaults", () => {
    expect(extractLiveModelLimits({
      capabilities: { contextWindow: 1_048_576, maxInput: 1_048_576, maxOutput: 1_048_576, defaultOutput: 131_072 },
      default_generation_settings: { max_tokens: 4_096 },
    })).toEqual({ contextWindow: 1_048_576, maxInput: 1_048_576, maxOutput: 1_048_576, defaultOutput: 131_072 });
    expect(extractLiveModelLimits({ defaultOutput: "131072" })).toEqual({ defaultOutput: 131_072 });
    expect(extractLiveModelLimits({ defaultOutput: -1, default_generation_settings: { max_tokens: 4_096 } })).toEqual({});
  });
  it("normalizes Kimchi metadata through the same validation", () => {
    expect(normalizeKimchiModel({
      slug: "safe",
      limits: { context_window: 99_000_000, max_output_tokens: 16_000 },
    })).toMatchObject({
      id: "safe",
      maxOutputTokens: 16_000,
      capabilities: { maxOutput: 16_000 },
    });
    expect(normalizeKimchiModel({
      slug: "safe",
      limits: { context_window: 99_000_000 },
    }).contextLength).toBeUndefined();
  });
  it("indexes fetched limits synchronously by provider, credential, and model", async () => {
    clearLiveModelLimitsCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "model-x", context_window: 128_000, max_output_tokens: 8_000 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const connection = { apiKey: "test-key", providerSpecificData: { baseUrl: "https://catalog.test/v1" } };
    try {
      expect(getCachedLiveLimits("test", "model-x", connection)).toBeNull();
      await expect(resolveLiveOpenAIModels(connection, { provider: "test", guard: "none" }))
        .resolves.toMatchObject({ models: [{ id: "model-x" }] });
      expect(getCachedLiveLimits("test", "model-x", connection)).toEqual({ contextWindow: 128_000, maxOutput: 8_000 });
      expect(getCachedLiveLimits("test", "model-x", { ...connection, apiKey: "other-key" })).toBeNull();
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      clearLiveModelLimitsCache();
    }
  });
  it("indexes every coalesced caller under its own provider and connection", async () => {
    clearLiveModelLimitsCache();
    let releaseFetch;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => {
      releaseFetch = () => resolve(new Response(JSON.stringify({
        data: [{ id: "model-x", context_window: 128_000 }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    })));
    const first = { apiKey: "shared-key", connectionId: "first", providerSpecificData: { baseUrl: "https://catalog.test/v1" } };
    const second = { apiKey: "shared-key", connectionId: "second", providerSpecificData: { baseUrl: "https://catalog.test/v1" } };
    try {
      const firstResult = resolveLiveOpenAIModels(first, { provider: "provider-a", guard: "none" });
      const secondResult = resolveLiveOpenAIModels(second, { provider: "provider-b", guard: "none" });
      releaseFetch();
      await Promise.all([firstResult, secondResult]);

      expect(fetch).toHaveBeenCalledOnce();
      expect(getCachedLiveLimits("provider-a", "model-x", first)).toEqual({ contextWindow: 128_000 });
      expect(getCachedLiveLimits("provider-b", "model-x", second)).toEqual({ contextWindow: 128_000 });
    } finally {
      vi.unstubAllGlobals();
      clearLiveModelLimitsCache();
    }
  });
  it.each([
    ["root canonical flags", {
      vision: false, reasoning: false,
      capabilities: { image_input: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true } } } },
    }],
    ["capability canonical flags", {
      capabilities: {
        vision: false, reasoning: false, image_input: { supported: true },
        thinking: { supported: true, types: { enabled: { supported: true } } },
      },
    }],
    ["unsupported thinking with enabled/adaptive hints", {
      capabilities: {
        image_input: { supported: false },
        thinking: { supported: false, types: { enabled: { supported: true }, adaptive: { supported: true } } },
      },
    }],
    ["unsupported boolean thinking with support hints", {
      capabilities: { vision: false, thinking: false, supports: { vision: true, reasoning: true } },
    }],
  ])("keeps native Anthropic explicit false over %s through cache and serialization", async (_name, declaration) => {
    clearLiveModelLimitsCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "claude-explicit-false", max_input_tokens: 1000000, max_tokens: 128000, ...declaration }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const connection = { id: "native-false-connection", apiKey: "test-key" };
    try {
      const result = await resolveLiveAnthropicModels(connection, { provider: "anthropic", guard: "none" });
      expect(result.models[0].capabilities).toMatchObject({
        vision: false, reasoning: false, contextWindow: 1000000, maxInput: 1000000, maxOutput: 128000,
      });
      expect(result.models[0].capabilities).not.toHaveProperty("thinkingFormat");
      expect(getCachedLiveLimits("anthropic", "claude-explicit-false", connection)).toMatchObject({ vision: false, reasoning: false });
      const generic = await buildModelsResponse(new Request("http://localhost/v1/models"), result.models).json();
      expect(generic.data[0]).toMatchObject({ reasoning: false, input: ["text"], capabilities: { vision: false, reasoning: false } });
      const native = await buildModelsResponse(new Request("http://localhost/v1/models", {
        headers: { "anthropic-version": "2023-06-01" },
      }), result.models).json();
      expect(native.data[0]).toMatchObject({
        max_input_tokens: 1000000, max_tokens: 128000,
        capabilities: { image_input: { supported: false }, thinking: { supported: false } },
      });
    } finally {
      vi.unstubAllGlobals();
      clearLiveModelLimitsCache();
    }
  });

  it.each([
    ["enabled", "claude-budget"],
    ["adaptive", "claude-adaptive"],
  ])("retains genuine native Anthropic %s thinking support", async (type, thinkingFormat) => {
    clearLiveModelLimitsCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "claude-supported", capabilities: { thinking: { types: { [type]: { supported: true } } } } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    try {
      const result = await resolveLiveAnthropicModels({ apiKey: "test-key" }, { guard: "none" });
      const generic = await buildModelsResponse(new Request("http://localhost/v1/models"), result.models).json();
      expect(generic.data[0].capabilities).toMatchObject({ reasoning: true, thinkingFormat });
      expect(generic.data[0]).not.toHaveProperty("max_model_len");
      expect(generic.data[0]).not.toHaveProperty("max_output_tokens");
    } finally {
      vi.unstubAllGlobals();
      clearLiveModelLimitsCache();
    }
  });
  it("negative-caches upstream errors", async () => {
    clearLiveModelLimitsCache();
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      throw new Error("offline");
    });
    const connection = { apiKey: "test-key", providerSpecificData: { baseUrl: "http://offline/v1" } };
    try {
      expect(await resolveLiveOpenAIModels(connection, { guard: "none" })).toBeNull();
      expect(await resolveLiveOpenAIModels(connection, { guard: "none" })).toBeNull();
      expect(calls).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      clearLiveModelLimitsCache();
    }
  });
});
