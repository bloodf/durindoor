import { describe, expect, it } from "vitest";
import githubAdapter from "../../open-sse/handlers/embeddingProviders/github.js";
import createOpenAIEmbeddingAdapter from "../../open-sse/handlers/embeddingProviders/openai.js";

const MODEL = "text-embedding-3-small";

// api.githubcopilot.com/embeddings rejects a bare string `input` with a 400.
describe("port decolua/9router #4951 — GitHub embeddings input shape", () => {
  it("wraps a bare string input into a one-element array", () => {
    expect(githubAdapter.buildBody(MODEL, { input: "hello world" }).input).toEqual(["hello world"]);
  });

  it("keeps an array input unchanged", () => {
    expect(githubAdapter.buildBody(MODEL, { input: ["a", "b"] }).input).toEqual(["a", "b"]);
  });

  it("keeps model, encoding_format and dimensions", () => {
    expect(githubAdapter.buildBody(MODEL, { input: "hi", encoding_format: "float", dimensions: 512 }))
      .toEqual({ model: MODEL, input: ["hi"], encoding_format: "float", dimensions: 512 });
  });

  it("leaves other OpenAI-compatible providers unchanged", () => {
    expect(createOpenAIEmbeddingAdapter("openai").buildBody(MODEL, { input: "hi" }).input).toBe("hi");
  });
});
