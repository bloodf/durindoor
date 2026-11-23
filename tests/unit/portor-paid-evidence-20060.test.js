import { describe, expect, it } from "vitest";
import { isFreeModel } from "../../open-sse/config/freeModelCatalog.js";
import { isOpenRouterFreeModel } from "../../open-sse/services/openrouterCatalog.js";

describe("paid evidence overrides free markers", () => {
  it("rejects contradictory flags and positive ancillary prices in both readers", () => {
    for (const model of [
      { id: "example:free", free: false, pricing: { prompt: "0", completion: "0" } },
      { id: "example:free", pricing: { prompt: "0", completion: "0", image: "0.01" } },
      { id: "example:free", isFree: true, is_free: false, pricing: { prompt: "0", completion: "0" } },
    ]) {
      expect(isFreeModel("openrouter", model)).toBe(false);
      expect(isOpenRouterFreeModel(model)).toBe(false);
    }
  });

  it("keeps an explicitly zero-priced free variant", () => {
    const model = { id: "example:free", pricing: { prompt: "0", completion: "0" } };
    expect(isFreeModel("openrouter", model)).toBe(true);
    expect(isOpenRouterFreeModel(model)).toBe(true);
  });
});
