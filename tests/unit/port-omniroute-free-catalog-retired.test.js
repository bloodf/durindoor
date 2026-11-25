import { describe, expect, it } from "vitest";
import { FREE_MODEL_BUDGETS } from "../../open-sse/config/freeModelCatalog.data.js";
import { RETIRED_FREE_ROWS } from "../../open-sse/config/freeModelCatalog.retired.data.js";
import { PROVIDERS_WITH_FREE_MODELS, isFreeModel } from "../../open-sse/config/freeModelCatalog.js";
import { isPaidModel } from "../../open-sse/providers/pricing.js";

const row = (provider, modelId) => FREE_MODEL_BUDGETS.find((m) => m.provider === provider && m.modelId === modelId);
const rows = (provider) => FREE_MODEL_BUDGETS.filter((m) => m.provider === provider);
const expectRetired = (list) => {
  expect(list.length).toBeGreaterThan(0);
  for (const m of list) {
    expect(m, `${m.provider}/${m.modelId}`).toMatchObject({ freeType: "discontinued", monthlyTokens: 0, creditTokens: 0 });
  }
};

describe("OmniRoute #21096 (cbe1172862a5) free-catalog re-audit and retired ledger", () => {
  it("never reports a discontinued offer as free", () => {
    expect(isFreeModel("pollinations", { id: "gemini" })).toBe(false);
    expect(isFreeModel("pollinations", { id: "openai" })).toBe(true);
    for (const provider of ["mistral", "bluesminds", "huggingface", "huggingchat", "llm7", "arcee-ai", "ollama-cloud"]) {
      expect(PROVIDERS_WITH_FREE_MODELS.has(provider), provider).toBe(false);
    }
  });

  it("retires every row of an offer that ended", () => {
    for (const provider of ["mistral", "bluesminds", "huggingface", "huggingchat", "llm7", "arcee-ai", "ollama-cloud"]) {
      expectRetired(rows(provider));
    }
    expectRetired([row("stepfun", "step-1v"), row("predibase", "llama-3.3-70b")]);
  });

  it("retires dead ids while the provider's surviving offer stays free", () => {
    expectRetired([
      row("groq", "qwen/qwen3.6-27b"),
      row("openrouter", "auto"),
      row("api-airforce", "x-ai/grok-2-1212"),
      row("api-airforce", "anthropic/claude-3.7-sonnet"),
      row("sambanova", "DeepSeek-V3.2"),
      row("sambanova", "Meta-Llama-3.3-70B-Instruct"),
      ...rows("bazaarlink").filter((m) => m.modelId !== "auto:free"),
    ]);
    expect(isPaidModel("groq/openai/gpt-oss-120b")).toBe(false);
    expect(isPaidModel("bazaarlink/auto:free")).toBe(false);
    expect(isPaidModel("openrouter/google/gemma-4-31b-it:free")).toBe(false);
    expect(row("openrouter", "google/gemma-4-31b-it:free")).toMatchObject({ monthlyTokens: 1_200_000, poolKey: "openrouter-free" });
  });

  it("hides retired offers from the hide-paid classifier, including former (Free) registry names", () => {
    for (const model of [
      "mistral/mistral-large-latest",
      "huggingface/deepseek-ai/DeepSeek-V3",
      "llm7/gpt-4o-mini-2024-07-18",
      "groq/qwen/qwen3.6-27b",
      "openrouter/auto",
      "af/x-ai/grok-2-1212",
      "api-airforce/anthropic/claude-3.7-sonnet",
    ]) {
      expect(isPaidModel(model), model).toBe(true);
    }
  });

  it("applies the corrected quotas", () => {
    expect(row("bazaarlink", "auto:free").monthlyTokens).toBe(1_440_000);
    expect(row("sambanova", "gpt-oss-120b").monthlyTokens).toBe(480_000);
    for (const id of ["morph-v3-large", "morph-v3-fast"]) expect(row("morph", id).monthlyTokens).toBe(160_000);
    for (const m of rows("agentrouter")) expect(m).toMatchObject({ freeType: "one-time-initial", creditTokens: 0 });
  });

  it("keeps each ledger row paired with a discontinued, zeroed catalog row", () => {
    expect(RETIRED_FREE_ROWS).toHaveLength(95);
    expect(new Set(RETIRED_FREE_ROWS.map((r) => `${r.provider}/${r.modelId}`)).size).toBe(RETIRED_FREE_ROWS.length);
    for (const entry of RETIRED_FREE_ROWS) {
      expect(row(entry.provider, entry.modelId), `${entry.provider}/${entry.modelId}`).toMatchObject({
        freeType: "discontinued",
        monthlyTokens: 0,
        creditTokens: 0,
      });
      expect(entry.lastListedMonthlyTokens).toBeGreaterThan(0);
      expect(entry.evidence).toContain("2026-11-23");
    }
  });
});
