import { describe, expect, it } from "vitest";
import createOpenAIEmbeddingAdapter from "../../open-sse/handlers/embeddingProviders/openai.js";

describe("NVIDIA EmbedQA input type", () => {
  it("defaults the EmbedQA request to query without changing other models", () => {
    const adapter = createOpenAIEmbeddingAdapter("nvidia");
    expect(adapter.buildBody("nvidia/nv-embedqa-e5-v5", { input: "hello" })).toEqual({
      model: "nvidia/nv-embedqa-e5-v5", input: "hello", input_type: "query"
    });
    expect(adapter.buildBody("other", { input: "hello" })).toEqual({ model: "other", input: "hello" });
    expect(adapter.buildBody("nvidia/nv-embedqa-e5-v5", { input: "hello", input_type: "passage" }).input_type).toBe("passage");
  });
});
