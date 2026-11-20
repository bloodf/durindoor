import { describe, expect, it } from "vitest";
import cloudflare from "../../open-sse/handlers/imageProviders/cloudflareAi.js";
import registry from "../../open-sse/providers/registry/cloudflare-ai.js";

describe("Cloudflare image dimensions", () => {
  it("omits dimensions for FLUX.1 Schnell while retaining other parameters", async () => {
    const model = "@cf/black-forest-labs/flux-1-schnell";
    const result = await cloudflare.buildBody(model, { prompt: "apple", size: "1024x1024", width: 512, height: 512, steps: 4 });
    expect(result).toEqual({ prompt: "apple", steps: 4 });
    expect(registry.models.find((entry) => entry.id === model).params).toEqual([]);
    expect(await cloudflare.buildBody("other", { prompt: "apple", size: "512x512" })).toMatchObject({ width: 512, height: 512 });
  });
});
