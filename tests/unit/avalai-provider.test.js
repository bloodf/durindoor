import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("AvalAI provider", () => {
  it("registers its API key chat endpoint and model catalog", () => {
    expect(REGISTRY.find((entry) => entry.id === "avalai")).toMatchObject({ category: "apikey", alias: "avalai" });
    expect(PROVIDERS.avalai).toMatchObject({ format: "openai", baseUrl: "https://api.avalai.ir/v1/chat/completions", validateUrl: "https://api.avalai.ir/v1/models" });
    expect(PROVIDER_MODELS.avalai.map((model) => model.id)).toContain("claude-sonnet-4-20250514");
    expect(new DefaultExecutor("avalai").buildUrl("claude-sonnet-4-20250514", false)).toBe("https://api.avalai.ir/v1/chat/completions");
  });
});
