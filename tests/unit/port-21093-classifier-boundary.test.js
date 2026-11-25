import { describe, expect, it } from "vitest";
import { isFreeModel } from "../../open-sse/config/freeModelCatalog.js";

describe("OmniRoute #21093 (69f39e8a839a) reporting gate boundary", () => {
  it("does not treat reporting gate metadata as a price or a free-model signal", () => {
    const gates = ["card", "phone"];
    expect(isFreeModel("api-airforce", { id: "x-ai/grok-3", gates })).toBe(true);
    expect(isFreeModel("api-airforce", { id: "unlisted-model", gates })).toBe(false);
    expect(isFreeModel("api-airforce", {
      id: "x-ai/grok-3", gates, pricing: { prompt: 1, completion: 1 },
    })).toBe(false);
  });
});
