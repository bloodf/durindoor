import { describe, expect, it, vi } from "vitest";
import { normalizeKimchiModel } from "../../open-sse/services/kimchiModels.js";

import {
  clearLiveModelLimitsCache,
  extractLiveModelLimits,
  resolveLiveOpenAIModels,
} from "../../open-sse/services/liveModelLimits.js";

describe("extractLiveModelLimits", () => {
  it("reads documented aliases in limits, meta, then root precedence", () => {
    expect(extractLiveModelLimits({
      context_length: 32_000,
      meta: { context_window: 64_000 },
      limits: { max_input_tokens: 128_000, max_output_tokens: 16_000 },
    })).toEqual({ contextWindow: 128_000, maxOutput: 16_000 });
  });

  it("rejects non-positive, non-integral, and absurd token limits", () => {
    expect(extractLiveModelLimits({
      context_window: 99_000_000,
      context_length: true,
      max_output_tokens: -1,
      limits: { context_length: 3.5, max_output_tokens: "junk" },
    })).toEqual({});
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
