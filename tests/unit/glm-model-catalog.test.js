import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import providers from "../../cli/src/cli/menus/providers.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const { PROVIDER_MODELS } = providers.__test__;

function providerModelIds(providerId) {
  return REGISTRY.find((provider) => provider.id === providerId)?.models.map(({ id }) => id) ?? [];
}


describe("GLM 5.3 catalog", () => {
  it("exposes the Coding Plan model through both native registries and the CLI", () => {
    expect(providerModelIds("glm")).toContain("glm-5.3");
    expect(providerModelIds("glm-cn")).toContain("glm-5.3");
    expect(PROVIDER_MODELS.glm.map(({ id }) => id)).toContain("glm-5.3");
  });

  it("uses its exact native capability contract before family fallbacks", () => {
    const caps = getCapabilitiesForModel("glm", "glm-5.3");

    expect(caps).toMatchObject({
      reasoning: true,
      thinkingFormat: "zai",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 131072,
    });
    expect(caps.maxOutput).toBeLessThan(caps.contextWindow);
  });

  it("uses the bare GLM-5.3 capability contract for the documented [1m] alias", () => {
    expect(getCapabilitiesForModel("glm", "GLM-5.3[1M]")).toEqual(
      getCapabilitiesForModel("glm", "glm-5.3"),
    );
  });
});

