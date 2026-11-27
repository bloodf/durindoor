import { describe, expect, it } from "vitest";
import { FREE_MODEL_BUDGETS } from "../../open-sse/config/freeModelCatalog.data.js";
import { RETIRED_FREE_ROWS } from "../../open-sse/config/freeModelCatalog.retired.data.js";
import { isFreeModel, providerHasFreeModels } from "../../open-sse/config/freeModelCatalog.js";

const rows = (provider) => FREE_MODEL_BUDGETS.filter((row) => row.provider === provider);

describe("sourced recurring offers", () => {
  it.each([
    ["meganova-ai", 8, "meganova-free", 1_200_000],
    ["free-ai", 10, "free-ai", 800_000],
    ["kenari", 15, "kenari-free", 1_200_000],
    ["aion", 6, "aion-free", 600_000],
  ])("records %s as one shared pool", (provider, count, pool, allowance) => {
    const offer = rows(provider);
    expect(offer).toHaveLength(count);
    expect(new Set(offer.map((row) => row.modelId)).size).toBe(count);
    for (const row of offer) {
      expect(row).toMatchObject({ poolKey: pool, monthlyTokens: allowance, creditTokens: 0, freeType: "recurring-daily" });
      expect(isFreeModel(provider, { id: row.modelId })).toBe(true);
    }
    const pools = new Map(offer.map((row) => [row.poolKey, row.monthlyTokens]));
    expect([...pools.values()].reduce((sum, value) => sum + value, 0)).toBe(allowance);
  });

  it("keeps Aion's allowance behind card verification", () => {
    expect(rows("aion").every((row) => row.gates?.includes("card"))).toBe(true);
  });

  it("keeps LLM7 discontinued and out of the active classifier", () => {
    expect(providerHasFreeModels("llm7")).toBe(false);
    for (const row of rows("llm7")) {
      expect(row).toMatchObject({ freeType: "discontinued", monthlyTokens: 0, creditTokens: 0 });
      expect(isFreeModel("llm7", { id: row.modelId })).toBe(false);
    }
    expect(RETIRED_FREE_ROWS.filter((row) => row.provider === "llm7")).toEqual([]);
  });
});
