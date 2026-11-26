import { describe, expect, it } from "vitest";
import { getProviderModels } from "open-sse/config/providerModels.js";

describe("OmniRoute #21221: Z.AI static catalog lists GLM 5.4", () => {
  it("lists glm-5.4 for the installed zai provider", () => {
    expect(getProviderModels("zai")).toContainEqual(
      expect.objectContaining({ id: "glm-5.4", name: "GLM 5.4" }),
    );
  });
});
