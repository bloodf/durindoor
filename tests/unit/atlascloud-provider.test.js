import { describe, expect, it } from "vitest";
import providers from "../../open-sse/providers/registry/index.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

describe("Atlas Cloud provider", () => {
  it("registers fixed endpoints and discovers chat models", () => {
    const provider = providers.find((entry) => entry.id === "atlascloud");
    expect(provider.transport.baseUrl).toBe("https://api.atlascloud.ai/v1/chat/completions");
    expect(provider.transport.validateUrl).toBe("https://api.atlascloud.ai/v1/models");
    expect(provider.modelsFetcher).toEqual({ url: provider.transport.validateUrl, type: "openai" });
    expect(provider.passthroughModels).toBe(true);
    expect(FILTERS.openai([{ id: "qwen/example" }, { id: "text-embedding-example" }])).toEqual([{ id: "qwen/example", name: "qwen/example" }]);
  });
});
