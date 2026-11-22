import { describe, expect, it } from "vitest";
import createOpenAIAdapter from "../../open-sse/handlers/imageProviders/openai.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

describe("OpenAI image generation options", () => {
  const adapter = createOpenAIAdapter("openai");
  it("forwards planning, moderation and JPEG compression", () => {
    expect(adapter.buildBody("image", { prompt: "cat", complexity: "high", moderation: "low", output_format: "JPEG", output_compression: 42 })).toMatchObject({ complexity: "high", moderation: "low", output_format: "jpeg", output_compression: 42 });
  });
  it("omits compression for PNG and non-finite values", () => {
    expect(adapter.buildBody("image", { prompt: "cat", output_format: "png", output_compression: 42 })).not.toHaveProperty("output_compression");
    expect(adapter.buildBody("image", { prompt: "cat", output_format: "webp", output_compression: NaN })).not.toHaveProperty("output_compression");
  });
  it("rejects GIF compression before contacting the provider", async () => {
    const result = await handleImageGenerationCore({ body: { prompt: "cat", output_format: "gif", output_compression: 1 }, modelInfo: { provider: "openai", model: "image" }, credentials: {} });
    expect(result.status).toBe(400);
  });
});
