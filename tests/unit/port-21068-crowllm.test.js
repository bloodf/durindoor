import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

describe("OmniRoute #21068 CrowLLM gateway (2acc39071a613122b6a5aec36ff954c88915b615)", () => {
  it("registers discovery and passes arbitrary model names to the OpenAI executor", () => {
    const entry = REGISTRY.find((provider) => provider.id === "crowllm");
    expect(entry.passthroughModels).toBe(true);
    expect(resolveProviderAlias("crowllm")).toBe("crowllm");
    expect(PROVIDERS.crowllm).toMatchObject({ format: "openai", authType: "apikey" });
    expect(PROVIDER_MEDIA.crowllm.modelsFetcher).toEqual({ url: "https://crowllm.com/v1/models", type: "openai" });
    const executor = new DefaultExecutor("crowllm");
    expect(executor.buildUrl("vendor/model:free", false)).toBe("https://crowllm.com/v1/chat/completions");
    expect(executor.buildHeaders({ apiKey: "fixture-key" }, false)).toMatchObject({ Authorization: "Bearer fixture-key" });
    const body = { model: "vendor/model:free", messages: [{ role: "user", content: "hello" }] };
    expect(executor.transformRequest(body.model, body, false, {})).toEqual(body);
  });
});
