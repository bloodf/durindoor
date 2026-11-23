import { describe, expect, it } from "vitest";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import nvidia from "../../open-sse/providers/registry/nvidia.js";

describe("NVIDIA image generation", () => {
  it("routes catalogued FLUX requests and normalizes artifacts", () => {
    const adapter = getImageAdapter("nvidia");
    const model = "black-forest-labs/flux.1-dev";
    expect(nvidia.serviceKinds).toContain("image");
    expect(nvidia.models.find((entry) => entry.id === model)?.kind).toBe("image");
    expect(adapter.buildUrl(model, { providerSpecificData: { baseUrl: "https://evil.example" } })).toBe(`https://ai.api.nvidia.com/v1/genai/${model}`);
    expect(() => adapter.buildUrl("../../other")).toThrow();
    expect(adapter.buildBody(model, { prompt: "cat", size: "768x1344", cfg_scale: 1.1 })).toEqual({ prompt: "cat", width: 768, height: 1344, mode: "base", cfg_scale: 1.1 });
    expect(adapter.normalize({ artifacts: [{ base64: "abc" }] }).data).toEqual([{ b64_json: "abc" }]);
    expect(() => adapter.buildBody("black-forest-labs/flux.1-kontext-dev", { prompt: "edit" })).toThrow();
  });
});
