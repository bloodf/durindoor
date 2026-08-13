import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";

const ADDED_MODELS = [
  ["anthropic", "claude-opus-4-8", 1_000_000, 128_000],
  ["anthropic", "claude-opus-4-7", 1_000_000, 128_000],
  ["anthropic", "claude-sonnet-4-6", 1_000_000, 128_000],
  ["anthropic", "claude-opus-4-6", 1_000_000, 128_000],
  ["anthropic", "claude-opus-4-5-20251101", 200_000, 64_000],
  ["anthropic", "claude-sonnet-4-5-20250929", 1_000_000, 64_000],
  ["glm", "glm-4.5", 131_072, undefined],
  ["glm", "glm-4.5-air", 131_072, undefined],
  ["glm", "glm-4.6", 200_000, 131_072],
  ["glm", "glm-5-turbo", 200_000, 131_072],
  ["cx", "codex-auto-review", 272_000, undefined],
  ["cloudflare-ai", "@cf/openai/gpt-oss-120b", 128_000, undefined],
  ["cloudflare-ai", "@cf/google/gemma-2b-it-lora", 8_192, undefined],
  ["cloudflare-ai", "@cf/meta/llama-guard-3-8b", 131_072, undefined],
  ["cloudflare-ai", "@cf/mistral/mistral-7b-instruct-v0.2-lora", 15_000, undefined],
  ["cloudflare-ai", "@cf/moonshotai/kimi-k2.7-code", 262_144, undefined],
  ["cloudflare-ai", "@cf/meta/llama-3.1-8b-instruct-fp8", 32_000, undefined],
  ["cloudflare-ai", "@cf/meta-llama/llama-2-7b-chat-hf-lora", 8_192, undefined],
  ["cloudflare-ai", "@cf/ibm-granite/granite-4.0-h-micro", 131_000, undefined],
  ["cloudflare-ai", "@cf/zai-org/glm-5.2", 262_144, undefined],
  ["cloudflare-ai", "@cf/nvidia/nemotron-3-120b-a12b", 256_000, undefined],
  ["cloudflare-ai", "@cf/aisingapore/gemma-sea-lion-v4-27b-it", 128_000, undefined],
  ["cloudflare-ai", "@cf/qwen/qwen3-30b-a3b-fp8", 32_768, undefined],
  ["cloudflare-ai", "@cf/google/gemma-7b-it-lora", 3_500, undefined],
  ["cloudflare-ai", "@cf/google/gemma-4-26b-a4b-it", 256_000, undefined],
  ["cloudflare-ai", "@cf/meta/llama-3.2-11b-vision-instruct", 128_000, undefined],
  ["cloudflare-ai", "@cf/openai/gpt-oss-20b", 128_000, undefined],
  ["cloudflare-ai", "@cf/meta/llama-4-scout-17b-16e-instruct", 131_000, undefined],
  ["cloudflare-ai", "@cf/baai/bge-m3", 60_000, undefined],
  ["cloudflare-ai", "@cf/qwen/qwen3-embedding-0.6b", 8_192, undefined],
  ["cloudflare-ai", "@cf/pfnet/plamo-embedding-1b", null, undefined],
  ["cloudflare-ai", "@cf/baai/bge-small-en-v1.5", null, undefined],
  ["cloudflare-ai", "@cf/baai/bge-base-en-v1.5", 153_600, undefined],
  ["cloudflare-ai", "@cf/google/embeddinggemma-300m", null, undefined],
  ["cloudflare-ai", "@cf/baai/bge-large-en-v1.5", null, undefined],
];

const CODEX_BASE_WINDOWS = [
  ["gpt-5.5", 272_000],
  ["gpt-5.4", 272_000],
  ["gpt-5.4-mini", 272_000],
  ["gpt-5.3-codex-spark", 128_000],
];

describe("live provider catalog additions (2026-08-13)", () => {
  it.each(ADDED_MODELS)("registers %s/%s with documented limits", (provider, id, contextWindow, maxOutput) => {
    expect(PROVIDER_MODELS[provider].map((model) => model.id)).toContain(id);
    expect(getCapabilitiesForModel(provider, id)).toMatchObject({ contextWindow, maxOutput });
  });

  it.each(CODEX_BASE_WINDOWS)("uses Codex's served context_window for %s", (id, contextWindow) => {
    expect(getCapabilitiesForModel("cx", id)).toMatchObject({
      contextWindow,
      maxOutput: undefined,
    });
  });

  it("keeps every newly-added generation ceiling below its context window", () => {
    for (const [provider, id] of ADDED_MODELS) {
      const { contextWindow, maxOutput } = getCapabilitiesForModel(provider, id);
      if (Number.isFinite(maxOutput)) expect(maxOutput, `${provider}/${id}`).toBeLessThan(contextWindow);
    }
  });
});
