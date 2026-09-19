import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

describe("ainetcafe provider (Kimi K3)", () => {
  const ainetcafe = REGISTRY.find((entry) => entry.id === "ainetcafe");

  it("registers an API-key OpenAI-compatible transport", () => {
    expect(ainetcafe).toBeDefined();
    expect(ainetcafe.category).toBe("apikey");
    expect(ainetcafe.authType).toBe("apikey");
    expect(PROVIDERS.ainetcafe).toMatchObject({
      baseUrl: "https://microquickjs.com/v1/chat/completions",
      validateUrl: "https://microquickjs.com/v1/models",
      format: "openai",
      authType: "apikey",
    });
  });

  it("seeds a catalog while still accepting unlisted model ids", () => {
    expect(ainetcafe.passthroughModels).toBe(true);
    expect(PROVIDER_MEDIA.ainetcafe.serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MEDIA.ainetcafe.modelsFetcher).toEqual({
      url: "https://microquickjs.com/v1/models",
      type: "openai",
    });
    expect(PROVIDER_MODELS.ainetcafe.map((model) => model.id)).toEqual([
      "Kimi-K3",
      "GLM5.2",
      "deepseek-v4-flash",
      "MiniMax-H3",
    ]);
  });

  it("resolves its own id as its alias", () => {
    expect(resolveProviderAlias("ainetcafe")).toBe("ainetcafe");
  });

  // The registry index is generated; a duplicate id would silently shadow an
  // existing provider's transport.
  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
