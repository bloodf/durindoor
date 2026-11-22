import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const GIF = Buffer.from("GIF89a\x01\x00\x01\x00").toString("base64");

async function generate(options, provider = "openai") {
  global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ created: 1, data: [{ b64_json: GIF }] }), { headers: { "Content-Type": "application/json" } }));
  const result = await handleImageGenerationCore({
    body: { prompt: "An animated bird", ...options },
    modelInfo: { provider, model: "gpt-image-2.5-sunburst" },
    credentials: { apiKey: "test-key" },
    log: null
  });
  expect(result.success).toBe(true);
  return JSON.parse(global.fetch.mock.calls[0][1].body);
}

describe("OmniRoute #20976: OpenAI image generation options", () => {
  const realFetch = global.fetch;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = realFetch; });

  it("forwards complexity and moderation for GIF", async () => {
    const sent = await generate({ output_format: " GIF ", complexity: "low", moderation: "auto" });
    expect(sent.complexity).toBe("low");
    expect(sent.moderation).toBe("auto");
    expect("output_compression" in sent).toBe(false);
  });

  it("rejects GIF compression without an upstream request", async () => {
    const result = await handleImageGenerationCore({
      body: { prompt: "An animated bird", output_format: "gif", output_compression: 50 },
      modelInfo: { provider: "openai", model: "gpt-image-2.5-sunburst" },
      credentials: { apiKey: "test-key" },
    });
    expect(result.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [" JPEG ", 0],
    ["webp", 72]
  ])("forwards compression with the %s container", async (format, compression) => {
    const sent = await generate({ output_format: format, output_compression: compression });
    expect(sent.output_format).toBe(format.trim().toLowerCase());
    expect(sent.output_compression).toBe(compression);
  });

  it.each(["png", "svg", undefined])("omits compression for %s", async (format) => {
    const sent = await generate({ output_format: format, output_compression: 70 });
    expect("output_compression" in sent).toBe(false);
  });

  it("does not leak complexity to other OpenAI-compatible image providers", async () => {
    const sent = await generate({ complexity: "low" }, "openrouter");
    expect("complexity" in sent).toBe(false);
  });
});
