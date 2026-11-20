import { describe, expect, it } from "vitest";
import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import registry from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MODELS_CONFIG } from "@/app/api/providers/[id]/models/modelsConfig.js";

describe("ParalonCloud", () => {
  it("registers chat and embedding endpoints and a model discovery route", () => {
    const provider = registry.find((entry) => entry.id === "paraloncloud");
    expect(provider.transport.baseUrl).toBe("https://paraloncloud.com/v1/chat/completions");
    expect(provider.transport.validateUrl).toBe("https://paraloncloud.com/v1/models");
    const embeddingAdapter = getEmbeddingAdapter("paraloncloud");
    expect(embeddingAdapter.buildUrl()).toBe("https://paraloncloud.com/v1/embeddings");
    expect(embeddingAdapter.buildHeaders({ apiKey: "test-key" })).toMatchObject({
      Authorization: "Bearer test-key",
    });
    expect(provider.models.find((model) => model.kind === "embedding")?.id).toBe("multilingual-e5-small");
    expect(PROVIDER_MODELS_CONFIG.paraloncloud).toBeDefined();
  });
});
