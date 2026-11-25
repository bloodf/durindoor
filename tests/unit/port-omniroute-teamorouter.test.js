import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

describe("OmniRoute #21189 96500f2ffb2b4823a9ff974617adf448bdef0886 TeamoRouter gateway", () => {
  it("registers discovery and passes arbitrary model names to the OpenAI executor", () => {
    const entry = REGISTRY.find((provider) => provider.id === "teamorouter");
    expect(entry.passthroughModels).toBe(true);
    expect(resolveProviderAlias("teamorouter")).toBe("teamorouter");
    expect(PROVIDERS.teamorouter).toMatchObject({ format: "openai", authType: "apikey" });
    expect(PROVIDER_MEDIA.teamorouter.modelsFetcher).toEqual({ url: "https://api.teamorouter.com/v1/models", type: "openai" });
    const executor = new DefaultExecutor("teamorouter");
    expect(executor.buildUrl("vendor/model:free", false)).toBe("https://api.teamorouter.com/v1/chat/completions");
    expect(executor.buildHeaders({ apiKey: "fixture-key" }, false)).toMatchObject({ Authorization: "Bearer fixture-key" });
    const body = { model: "vendor/model:free", messages: [{ role: "user", content: "hello" }] };
    expect(executor.transformRequest(body.model, body, false, {})).toEqual(body);
  });
});
