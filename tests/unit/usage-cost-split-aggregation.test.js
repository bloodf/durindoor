// Review follow-ups for the per-rate usage cost split (upstream 9router #4216)
// and request timing (#4193). Both SQLite and PostgreSQL feed the same JS
// aggregation, so these exercise it directly: the category columns must add up
// to the bucket's recorded cost on every dimension.
import { describe, expect, it, vi } from "vitest";
import { addLatency, aggregateEntryToDay, applyCostBreakdowns } from "@/lib/db/repos/usageRepo.js";
import { USAGE_COST_FIELDS } from "@/shared/utils/usageCostAllocation.js";

const cheap = { input: 1, cached: 0.1, output: 2 };
const dear = { input: 10, cached: 1, output: 40 };

function bucket(extra) {
  return { requests: 1, promptTokens: 1000, completionTokens: 500, cachedTokens: 200, reasoningTokens: 0, cacheCreationTokens: 0, ...extra };
}

function emptyStats() {
  return { byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {} };
}

const splitSum = (entry) => USAGE_COST_FIELDS.reduce((sum, field) => sum + entry[field], 0);

describe("aggregateEntryToDay account model tracking", () => {
  const entry = (model) => ({ provider: "openai", model, connectionId: "conn-1", tokens: { prompt_tokens: 10, completion_tokens: 5 }, cost: 0.1 });

  it("keeps a connection that served one model marked single-model", () => {
    const day = {};
    aggregateEntryToDay(day, entry("a"));
    aggregateEntryToDay(day, entry("a"));
    expect(day.byAccount["conn-1"].singleModel).toBe(true);
  });

  it("marks a connection that served two models as mixed", () => {
    const day = {};
    aggregateEntryToDay(day, entry("a"));
    aggregateEntryToDay(day, entry("b"));
    aggregateEntryToDay(day, entry("a"));
    expect(day.byAccount["conn-1"].singleModel).toBe(false);
  });

  it("treats a legacy blob without the flag as mixed", () => {
    const day = { byAccount: { "conn-1": { requests: 1, promptTokens: 1, completionTokens: 1, cost: 0.1, rawModel: "a", provider: "openai" } } };
    aggregateEntryToDay(day, entry("a"));
    expect(day.byAccount["conn-1"].singleModel).toBe(false);
  });
});

describe("applyCostBreakdowns", () => {
  const lookup = async (provider, model) => ({ cheap, dear }[model] || null);

  it("leaves a mixed-model account bucket to the client fallback", async () => {
    const stats = emptyStats();
    stats.byAccount.mixed = bucket({ cost: 1, rawModel: "dear", rawProvider: "openai", mixedModels: true });
    stats.byAccount.single = bucket({ cost: 1, rawModel: "dear", rawProvider: "openai" });
    await applyCostBreakdowns(stats, lookup);

    expect(stats.byAccount.mixed.inputCost).toBeUndefined();
    expect(splitSum(stats.byAccount.single)).toBeCloseTo(1, 12);
  });

  it("sums provider columns to the provider cost when a model is unpriced", async () => {
    const stats = emptyStats();
    stats.byProvider.openai = bucket({ promptTokens: 2000, completionTokens: 1000, cachedTokens: 400, cost: 3 });
    stats.byModel.priced = bucket({ cost: 1, rawModel: "cheap", rawProvider: "openai" });
    stats.byModel.unpriced = bucket({ cost: 2, rawModel: "mystery", rawProvider: "openai" });
    await applyCostBreakdowns(stats, lookup);

    expect(stats.byModel.unpriced.inputCost).toBeUndefined();
    expect(splitSum(stats.byProvider.openai)).toBeCloseTo(3, 12);
  });

  it("publishes no provider split when none of its models is priced", async () => {
    const stats = emptyStats();
    stats.byProvider.openai = bucket({ cost: 2 });
    stats.byModel.unpriced = bucket({ cost: 2, rawModel: "mystery", rawProvider: "openai" });
    await applyCostBreakdowns(stats, lookup);

    expect(stats.byProvider.openai.inputCost).toBeUndefined();
  });

  it("splits at base ratios when summed tokens cross a per-request long-context tier", async () => {
    const tiered = { ...cheap, longContextThreshold: 500, longContextInputMultiplier: 2, longContextOutputMultiplier: 1.5 };
    const stats = emptyStats();
    stats.byModel.m = bucket({ cost: 1, rawModel: "tiered", rawProvider: "openai" });
    await applyCostBreakdowns(stats, async () => tiered);

    const m = stats.byModel.m;
    // Base rates: 800 fresh * 1 + 200 cached * 0.1 : 500 output * 2.
    expect(m.inputCost / m.outputCost).toBeCloseTo(800 / 1000, 12);
    expect(splitSum(m)).toBeCloseTo(1, 12);
  });

  it("logs a failed pricing lookup and retries it instead of caching no pricing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn()
      .mockRejectedValueOnce(new Error("db locked"))
      .mockResolvedValue(cheap);
    const stats = emptyStats();
    stats.byModel.m = bucket({ cost: 1, rawModel: "cheap", rawProvider: "openai" });
    stats.byEndpoint.e = bucket({ cost: 1, rawModel: "cheap", rawProvider: "openai" });
    await applyCostBreakdowns(stats, failing);

    expect(errorSpy).toHaveBeenCalled();
    expect(stats.byModel.m.inputCost).toBeUndefined();
    expect(splitSum(stats.byEndpoint.e)).toBeCloseTo(1, 12);
    errorSpy.mockRestore();
  });
});

describe("addLatency", () => {
  it("keeps a stored zero instead of replacing it with the bucket's tokens", () => {
    const target = {};
    addLatency(target, { latencyMs: 1000, ttftMs: 200, latencySamples: 1, ttftSamples: 0, timedCompletionTokens: 0 }, 900);
    expect(target.timedCompletionTokens).toBe(0);
    expect(target.ttftSamples).toBe(0);
  });

  it("falls back to the row's own timing when no sums are stored", () => {
    const target = {};
    addLatency(target, { latencyMs: 1000, ttftMs: 200 }, 900);
    expect(target).toMatchObject({ latencySamples: 1, ttftSamples: 1, timedCompletionTokens: 900 });
  });

  it("does not count tokens from a row with no decode time", () => {
    const target = {};
    addLatency(target, { latencyMs: 500, ttftMs: 500 }, 900);
    expect(target.timedCompletionTokens).toBe(0);
  });
});
