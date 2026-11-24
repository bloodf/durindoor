import { describe, expect, it } from "vitest";
import go from "../../open-sse/providers/registry/opencode-go.js";
import zen from "../../open-sse/providers/registry/opencode-zen.js";
import cloudflare from "../../open-sse/providers/registry/cloudflare-ai.js";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";

describe("OmniRoute catalog metadata", () => {
  it.each([go, zen])("declares GLM reasoning and vision metadata on $id", (provider) => {
    for (const [id, supportsVision] of [["glm-5.3", false], ["glm-5.3-flash", true]]) {
      expect(provider.models.filter((model) => model.id === id)).toHaveLength(1);
      expect(provider.models.find((model) => model.id === id)).toMatchObject({ supportsReasoning: true, supportsVision });
    }
  });

  it.each(["glm-5.3", "glm-5.3-flash"])("routes Go %s through chat completions", (model) => {
    for (const sourceFormat of ["openai", "claude", "openai-responses"]) {
      const { runtimeTransport, targetFormat } = resolveRequestTransport({
        provider: "opencode-go", alias: "opencode-go", model, sourceFormat, credentials: { apiKey: "test-key" },
      });
      expect(targetFormat).toBe("openai");
      expect(runtimeTransport?.baseUrl).toBe("https://opencode.ai/inference/go/openai/v1/chat/completions");
    }
  });

  it("records the Cloudflare Mistral context length", () => {
    expect(cloudflare.models.filter((model) => model.id === "@cf/mistralai/mistral-small-3.1-24b-instruct"))
      .toEqual([{ id: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1 24B Instruct", contextLength: 128000 }]);
  });
});
