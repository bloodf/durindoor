import { describe, expect, it } from "vitest";
import { EMBEDDING_ADAPTERS, getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import { IMAGE_ADAPTERS, getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { TTS_ADAPTERS, getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";
import { MUSIC_ADAPTERS } from "../../open-sse/handlers/musicGenerationCore.js";
import { lookupMediaAdapter } from "../../open-sse/handlers/mediaRegistry.js";

describe("media adapter registries", () => {
  it.each([
    ["embedding", EMBEDDING_ADAPTERS, getEmbeddingAdapter, "cloudflare-ai", "buildUrl"],
    ["image", IMAGE_ADAPTERS, getImageAdapter, "gemini", "buildUrl"],
    ["tts", TTS_ADAPTERS, getTtsAdapter, "elevenlabs", "synthesize"],
  ])("exposes %s entries with a common shape and preserves lookup", (_kind, registry, lookup, provider, method) => {
    for (const entry of Object.values(registry)) {
      expect(Object.keys(entry)).toEqual(["adapter"]);
      expect(entry.adapter).toBeTruthy();
    }
    expect(lookup(provider)).toBe(registry[provider].adapter);
    expect(lookupMediaAdapter(registry, provider)).toBe(lookup(provider));
    expect(lookup(provider)[method]).toBeTypeOf("function");
    expect(lookupMediaAdapter(registry, "missing-provider")).toBeNull();
  });

  it("uses the same shape for web music provider configuration", () => {
    for (const entry of Object.values(MUSIC_ADAPTERS)) {
      expect(Object.keys(entry)).toEqual(["adapter"]);
      expect(entry.adapter.baseUrl).toBeTruthy();
    }
    expect(lookupMediaAdapter(MUSIC_ADAPTERS, "suno")).toBe(MUSIC_ADAPTERS.suno.adapter);
    expect(lookupMediaAdapter(MUSIC_ADAPTERS, "suno").baseUrl).toBe("https://studio-api.suno.ai/api/generate/v2/");
  });

  it("retains dynamic embedding and special TTS fallback behavior", () => {
    expect(getEmbeddingAdapter("openai-compatible-example")).toBeTruthy();
    expect(getEmbeddingAdapter("custom-embedding-example")).toBeTruthy();
    expect(getTtsAdapter("missing-provider")).toBeNull();
  });
});
