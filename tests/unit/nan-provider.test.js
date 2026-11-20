import { afterEach, describe, expect, it, vi } from "vitest";
import registry from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getImageEditConfig } from "../../open-sse/handlers/imageEditCore.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { formatNanUsage } from "../../open-sse/services/usage/nan.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

afterEach(() => vi.unstubAllGlobals());

describe("NaN provider", () => {
  it("registers chat and media endpoints and capabilities", () => {
    const nan = registry.find((entry) => entry.id === "nan");
    expect(nan.transport.validateUrl).toBe("https://api.nan.builders/v1/models");
    expect(getEmbeddingAdapter("nan").buildUrl()).toBe("https://api.nan.builders/v1/embeddings");
    expect(getImageAdapter("nan").buildUrl()).toBe("https://api.nan.builders/v1/images/generations");
    expect(getImageEditConfig(PROVIDER_MEDIA.nan).baseUrl).toBe("https://api.nan.builders/v1/images/edits");
    expect(PROVIDER_MEDIA.nan.rerankConfig.baseUrl).toBe("https://api.nan.builders/v1/rerank");
    expect(getCapabilitiesForModel("nan", "mimo-v2.5").audioInput).toBe(true);
  });
  it("requests streamed usage without overriding the client", () => {
    const executor = new DefaultExecutor("nan");
    const messages = [{ role: "user", content: "hello" }];
    expect(executor.transformRequest("gemma4", { messages }, true, {}).stream_options).toEqual({ include_usage: true });
    expect(executor.transformRequest("gemma4", { messages, stream_options: { include_usage: false } }, true, {}).stream_options).toEqual({ include_usage: false });
  });
  it("uses the NaN default voice and requested speech format", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/wav" } }));
    vi.stubGlobal("fetch", fetch);
    const result = await handleTtsCore({ provider: "nan", model: "kokoro", input: "Hello", credentials: { apiKey: "key" }, responseFormat: "wav" });
    expect(result.success).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ model: "kokoro", voice: "af_heart", response_format: "wav" });
  });
  it("validates quota counters and preserves reset times", () => {
    expect(formatNanUsage({ models: [{ model: "gemma4", tokensUsed: 20, cap: 100, periodEnd: "2026-11-01T00:00:00Z" }] }).quotas.gemma4).toEqual({ used: 20, total: 100, resetAt: "2026-11-01T00:00:00Z", unit: "tokens" });
    expect(formatNanUsage({ models: [{ model: "gemma4", tokensUsed: -1, cap: 100 }] }).quotas).toBeUndefined();
  });
});
