import { describe, expect, it } from "vitest";
import { FREE_MODEL_BUDGETS } from "../../open-sse/config/freeModelCatalog.data.js";
import { PROVIDERS_WITH_FREE_MODELS } from "../../open-sse/config/freeModelCatalog.js";
import { isPaidModel } from "../../open-sse/providers/pricing.js";
import { APIKEY_PROVIDERS, FREE_TIER_PROVIDERS } from "../../src/shared/constants/providers.js";

describe("OmniRoute #21247 (3bc14869ca48) UncloseAI keyless offer retirement", () => {
  it("lists UncloseAI as an API-key provider, not a free tier", () => {
    expect(APIKEY_PROVIDERS.uncloseai).toBeDefined();
    expect(FREE_TIER_PROVIDERS.uncloseai).toBeUndefined();
  });

  it("grants no free access to any UncloseAI model", () => {
    const rows = FREE_MODEL_BUDGETS.filter((m) => m.provider === "uncloseai");
    expect(rows.length).toBeGreaterThan(0);
    for (const m of rows) {
      expect(m).toMatchObject({ freeType: "discontinued", monthlyTokens: 0, creditTokens: 0 });
      expect(isPaidModel(`unc/${m.modelId}`), m.modelId).toBe(true);
    }
    expect(PROVIDERS_WITH_FREE_MODELS.has("uncloseai")).toBe(false);
  });
});
