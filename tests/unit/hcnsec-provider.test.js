import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

describe("Huancheng Public API provider", () => {
  const hcnsec = REGISTRY.find((entry) => entry.id === "hcnsec");

  it("registers hcnsec as an API-key provider with free-tier metadata", () => {
    expect(hcnsec).toBeDefined();
    expect(hcnsec.category).toBe("apikey");
    expect(hcnsec.alias).toBe("hcnsec");
    expect(hcnsec.hasFree).toBe(true);
    expect(hcnsec.display).toMatchObject({
      name: "Huancheng Public API",
      website: "https://api.hcnsec.cn",
      textIcon: "HC",
    });
  });

  it("builds OpenAI-compatible runtime transport and live model discovery", () => {
    expect(PROVIDERS.hcnsec).toMatchObject({
      format: "openai",
      baseUrl: "https://api.hcnsec.cn/v1/chat/completions",
      validateUrl: "https://api.hcnsec.cn/v1/models",
    });
    expect(hcnsec.modelsFetcher).toEqual({
      url: "https://api.hcnsec.cn/v1/models",
      type: "openai",
    });
  });

  it("relies on live catalog and passthrough models instead of static seeds", () => {
    expect(PROVIDER_MODELS.hcnsec).toEqual([]);
    expect(hcnsec.passthroughModels).toBe(true);
    expect(AI_PROVIDERS.hcnsec).toMatchObject({
      id: "hcnsec",
      alias: "hcnsec",
      passthroughModels: true,
      hasFree: true,
    });
  });
});
