import { describe, expect, it } from "vitest";
import { getProviderModels } from "../../open-sse/config/providerModels.js";

describe("Morph Compactor catalog", () => {
  it("exposes the upstream model for routing", () => {
    expect(getProviderModels("morph")).toContainEqual(
      expect.objectContaining({ id: "morph-compactor", name: "Morph Compactor" }),
    );
  });
});
