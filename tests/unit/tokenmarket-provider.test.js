import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

describe("Token Market provider", () => {
  const tokenmarket = REGISTRY.find((entry) => entry.id === "tokenmarket");

  it("registers an API-key OpenAI-compatible transport", () => {
    expect(tokenmarket).toBeDefined();
    expect(tokenmarket.category).toBe("apikey");
    expect(tokenmarket.authModes).toEqual(["apikey"]);
    expect(PROVIDERS.tokenmarket).toMatchObject({
      baseUrl: "https://api.tokensmarket.ai/v1/chat/completions",
      validateUrl: "https://api.tokensmarket.ai/v1/models",
      thinkingFormat: "tokenmarket",
      format: "openai",
    });
  });

  it("seeds a catalog while still accepting unlisted model ids", () => {
    expect(tokenmarket.passthroughModels).toBe(true);
    expect(PROVIDER_MEDIA.tokenmarket.serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MODELS.tokenmarket.map((model) => model.id)).toEqual([
      "claude-fable-5",
      "gpt-5.6-sol",
      "gemini-3.5-flash",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ]);
  });

  it("resolves both the short and long alias", () => {
    expect(resolveProviderAlias("tm")).toBe("tokenmarket");
    expect(resolveProviderAlias("tokenmarket")).toBe("tokenmarket");
  });

  // The registry index is generated; a duplicate id would silently shadow an
  // existing provider's transport.
  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
