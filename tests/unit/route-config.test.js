import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";

describe("route config", () => {
  it("includes hcnsec in PROVIDER_MODELS_CONFIG", () => {
    expect(PROVIDER_MODELS_CONFIG.hcnsec).toBeDefined();
    expect(PROVIDER_MODELS_CONFIG.hcnsec.url).toBe("https://api.hcnsec.cn/v1/models");
  });
});
