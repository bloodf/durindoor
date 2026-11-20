import { describe, expect, it } from "vitest";
import fal from "../../open-sse/handlers/imageProviders/falAi.js";
import stability from "../../open-sse/handlers/imageProviders/stabilityAi.js";
import createOpenAIAdapter from "../../open-sse/handlers/imageProviders/openai.js";

describe("existing image output options", () => {
  it("forwards the selected Fal format without changing its normalized payload", () => {
    expect(fal.buildBody("flux", { prompt: "a bird", output_format: "webp" }))
      .toEqual({ prompt: "a bird", num_images: 1, output_format: "webp" });
    expect(fal.normalize({ images: [{ url: "https://example.test/image.webp" }] }).data)
      .toEqual([{ url: "https://example.test/image.webp" }]);
  });

  it("retains existing Stability and OpenAI output options", () => {
    expect(stability.buildBody("core", { prompt: "a bird", output_format: "WEBP" }).output_format).toBe("webp");
    expect(createOpenAIAdapter("openai").buildBody("gpt-image-1", { prompt: "a bird", output_format: "jpeg" }).output_format).toBe("jpeg");
  });
});
