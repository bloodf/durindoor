import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import registry from "../../open-sse/providers/registry/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { parseModel } from "../../open-sse/services/model.js";

describe("UberLLM", () => {
  it("routes vendor-prefixed chat models and discovers the catalog", () => {
    const provider = registry.find((entry) => entry.id === "uberllm");
    expect(provider.modelsFetcher.url).toBe("https://api.uberllm.dev/v1/models");
    expect(provider.passthroughModels).toBe(true);
    expect(parseModel("ull/anthropic/claude-sonnet-5")).toMatchObject({ provider: "uberllm", model: "anthropic/claude-sonnet-5" });
    expect(PROVIDERS.uberllm.baseUrl).toBe("https://api.uberllm.dev/v1/chat/completions");
    expect(PROVIDERS.uberllm.validateUrl).toBe("https://api.uberllm.dev/v1/balance");
  });
  it("sends image requests to the same provider with bearer authentication", () => {
    const adapter = getImageAdapter("uberllm");
    expect(adapter.buildUrl()).toBe("https://api.uberllm.dev/v1/images/generations");
    expect(adapter.buildHeaders({ apiKey: "fixture" }).Authorization).toBe("Bearer fixture");
    expect(adapter.buildBody("venice/z-image-turbo", { prompt: "hello" })).toMatchObject({ model: "venice/z-image-turbo", prompt: "hello" });
  });
});
