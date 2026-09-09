// codebuddy-cn catalog/capabilities alignment with the copilot.tencent.com
// server product-config payload (upstream direct commit cec672d9d922).
// thinkingCanDisable maps to the server's reasoning.canDisableThinking flag —
// it is NOT the inverse of onlyReasoning.
import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import codebuddyCn from "../../open-sse/providers/registry/codebuddy-cn.js";
import glm from "../../open-sse/providers/registry/glm.js";
import glmCn from "../../open-sse/providers/registry/glm-cn.js";

describe("codebuddy-cn server-config alignment (upstream cec672d9)", () => {
  it("glm-5.3 family and deepseek-v4 family can disable thinking", () => {
    for (const id of ["glm-5.3", "glm-5.3-flash", "deepseek-v4-pro", "deepseek-v4-flash"]) {
      expect(getCapabilitiesForModel("codebuddy-cn", id)).toMatchObject({
        reasoning: true,
        thinkingCanDisable: true,
      });
    }
  });

  it("hy* models stay forced always-on (thinkingCanDisable: false)", () => {
    for (const id of ["hy3", "hy4-preview"]) {
      expect(getCapabilitiesForModel("codebuddy-cn", id)).toMatchObject({
        reasoning: true,
        thinkingCanDisable: false,
      });
    }
  });

  it("server-table output limits win over the old baked fallback", () => {
    expect(getCapabilitiesForModel("codebuddy-cn", "glm-5v-turbo")).toMatchObject({ maxOutput: 64000 });
    expect(getCapabilitiesForModel("codebuddy-cn", "minimax-m3")).toMatchObject({ maxOutput: 128000 });
    expect(getCapabilitiesForModel("codebuddy-cn", "glm-5.3-flash")).toMatchObject({ contextWindow: 1000000, maxOutput: 32000 });
    expect(getCapabilitiesForModel("codebuddy-cn", "kimi-k3-1")).toMatchObject({ contextWindow: 1000000 });
  });

  it("models absent from the server list are dropped from the catalog", () => {
    const ids = codebuddyCn.models.map(({ id }) => id);
    for (const dropped of [
      "glm-5.0-turbo",
      "minimax-m2.7",
      "kimi-k2.5",
      "hy3-preview",
      "hy3-x",
      "hy4-preview-x",
      "deepseek-v3-2-volc",
    ]) {
      expect(ids).not.toContain(dropped);
    }
    expect(ids).toEqual(expect.arrayContaining([
      "glm-5.2", "glm-5.1", "glm-5v-turbo", "minimax-m3", "kimi-k2.7", "kimi-k2.6",
      "hy3", "hy4-preview", "glm-5.3", "glm-5.3-flash", "kimi-k3-1",
      "deepseek-v4-pro", "deepseek-v4-flash",
    ]));
  });

  it("glm-5.2 publishes its server-declared high/xhigh effort set", () => {
    expect(getThinkingLevels("codebuddy-cn", "glm-5.2")).toEqual(["high", "xhigh"]);
  });

  it("glm-5-turbo is registered in the glm and glm-cn catalogs", () => {
    expect(glm.models.some(({ id }) => id === "glm-5-turbo")).toBe(true);
    expect(glmCn.models.some(({ id }) => id === "glm-5-turbo")).toBe(true);
  });
});
