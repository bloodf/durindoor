import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const generate = (options, provider = "openai") => handleImageGenerationCore({
  body: { prompt: "A bird", ...options },
  modelInfo: { provider, model: "gpt-image-2.5-sunburst" },
  credentials: { apiKey: "test-key" },
  log: null,
});

describe("OmniRoute #20976 (fb9539716d): OpenAI image option validation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ created: 1, data: [{ b64_json: "aGk=" }] }), { headers: { "content-type": "application/json" } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([
    { complexity: "extreme" },
    { moderation: "off" },
    { output_format: "jpeg", output_compression: 101 },
    { output_format: "webp", output_compression: -1 },
    { output_format: "webp", output_compression: 1.5 },
    { output_format: "webp", output_compression: "50" },
  ])("rejects %o before contacting OpenAI", async (options) => {
    const result = await generate(options);
    expect(result.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { complexity: "medium", moderation: "low", output_format: "jpeg", output_compression: 100 },
    { complexity: null, moderation: null, output_compression: null },
  ])("sends %o", async (options) => {
    expect((await generate(options)).success).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("leaves other providers to their own contract", async () => {
    expect((await generate({ moderation: "off" }, "openrouter")).success).toBe(true);
  });
});
