import { describe, expect, it } from "vitest";
import xai from "../../open-sse/providers/registry/xai.js";
import { PROVIDER_MODELS_CONFIG as MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";
import { PROVIDER_MODELS_CONFIG as PROVIDER_MODELS_CONFIG_LEGACY } from "../../src/app/api/providers/[id]/models/providerModelsConfig.js";

// Port of OmniRoute#14237: Anthropic's /v1/models GET returned only its
// default page size, truncating large catalogs; ?limit=1000 covers the
// catalog in one request. xAI accepts model ids the registry seed does not
// yet know about, matching xai-oauth's existing passthrough behavior.
describe("port(omniroute): #14237 Anthropic catalog page size and xAI passthrough", () => {
  it("requests the full Anthropic model catalog in one page (modelsConfig.js)", () => {
    expect(MODELS_CONFIG.claude.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(MODELS_CONFIG.anthropic.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
  });

  it("requests the full Anthropic model catalog in one page (providerModelsConfig.js)", () => {
    expect(PROVIDER_MODELS_CONFIG_LEGACY.claude.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(PROVIDER_MODELS_CONFIG_LEGACY.anthropic.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
  });

  it("forwards unknown xAI model ids instead of rejecting them", () => {
    expect(xai.passthroughModels).toBe(true);
  });
});
