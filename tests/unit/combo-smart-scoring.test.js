import { describe, it, expect, beforeEach } from "vitest";

import {
  getSmartScoredModels,
  resetComboScoring,
  handleComboChat,
} from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, debug() {}, error() {} };

function okResponse(model) {
  return Response.json({ choices: [{ message: { role: "assistant", content: model } }] });
}

// 429 (quota) -> smart-scoring penalizes with onQuota (-30) and, unlike 503/502/504,
// does NOT trigger the built-in 1-5s transient cooldown wait in handleComboChat.
function quotaResponse() {
  return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 });
}

describe("combo smart-scoring strategy", () => {
  beforeEach(() => {
    resetComboScoring();
  });

  it("returns models in original order when all scores are equal (cold start)", () => {
    const models = ["openai/gpt-4", "claude/opus", "gemini/pro"];
    const result = getSmartScoredModels(models, "test-combo");
    // All score=100, all lastSuccessMs=0 -> stable original order
    expect(result).toEqual(models);
  });

  it("returns single model unchanged", () => {
    expect(getSmartScoredModels(["openai/gpt-4"], "c")).toEqual(["openai/gpt-4"]);
  });

  it("returns empty/null unchanged", () => {
    expect(getSmartScoredModels([], "c")).toEqual([]);
    expect(getSmartScoredModels(null, "c")).toBeNull();
  });

  it("resetComboScoring clears specific combo", () => {
    const models = ["a/1", "b/2"];
    getSmartScoredModels(models, "combo-a");
    getSmartScoredModels(models, "combo-b");
    resetComboScoring("combo-a");
    // combo-b should still work fine
    expect(getSmartScoredModels(models, "combo-b")).toEqual(models);
  });

  it("drives _updateScore via handleComboChat: a 429 on provider/a lowers its score so the next call demotes it out of the lead slot (LRU picks cold provider/c first)", async () => {
    // This is the load-bearing behavioral check that the cold-start test above
    // cannot express: scoring state must be mutated by real request outcomes
    // (success -> +5, quota 429 -> -30) and feed back into ordering.
    const comboName = `smart-score-${Date.now()}`;
    const models = ["provider/a", "provider/b", "provider/c"];

    // First call: provider/a fails with 429, provider/b succeeds.
    const firstOrder = [];
    const first = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      comboName,
      comboStrategy: "smart-scoring",
      autoSwitch: false,
      log,
      handleSingleModel: async (_body, model) => {
        firstOrder.push(model);
        if (model === "provider/a") return quotaResponse();
        return okResponse(model);
      },
    });
    expect(first.ok).toBe(true);
    // a tried first, penalized; b served.
    expect(firstOrder[0]).toBe("provider/a");

    // Second call: every model succeeds, so handleComboChat returns on the
    // FIRST model it tries — `secondOrder` therefore contains exactly one
    // entry: whichever model the scorer put first. After round 1 the scores
    // are provider/a = 70 (quota -30), provider/b = 100 (success +5, clamped,
    // fresh lastSuccessMs), provider/c = 100 (cold, lastSuccessMs = 0). The
    // 100/100 tie breaks on LRU (smaller lastSuccessMs first) -> provider/c
    // (0) leads provider/b. The load-bearing contract is that the
    // quota-penalized provider/a is demoted out of the lead slot.
    const secondOrder = [];
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi again" }] },
      models,
      comboName,
      comboStrategy: "smart-scoring",
      autoSwitch: false,
      log,
      handleSingleModel: async (_body, model) => {
        secondOrder.push(model);
        return okResponse(model);
      },
    });
    expect(secondOrder).toHaveLength(1);
    expect(secondOrder[0]).not.toBe("provider/a");
    expect(secondOrder[0]).toBe("provider/c");
  });

  it("a 403/401 (forbidden) penalizes harder than a 429, dropping the model below a quota-penalized peer", async () => {
    const comboName = `smart-score-forbidden-${Date.now()}`;
    const models = ["provider/forbidden", "provider/quota"];

    // Round 1: forbidden-model gets 403 (-50), quota-model gets 429 (-30) then
    // both fall through with no success -> last error returned, but scores are
    // recorded regardless of the no-success outcome.
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      comboName,
      comboStrategy: "smart-scoring",
      autoSwitch: false,
      log,
      handleSingleModel: async (_body, model) => {
        if (model === "provider/forbidden") {
          return new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 });
        }
        return quotaResponse();
      },
    });

    // Round 2: both succeed. The quota-penalized model (70) outranks the
    // forbidden-penalized model (50), so it must be tried first.
    const order = [];
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi again" }] },
      models,
      comboName,
      comboStrategy: "smart-scoring",
      autoSwitch: false,
      log,
      handleSingleModel: async (_body, model) => {
        order.push(model);
        return okResponse(model);
      },
    });
    expect(order[0]).toBe("provider/quota");
  });
});
