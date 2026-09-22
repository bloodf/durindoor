// Review follow-ups for the per-rate usage cost split (upstream 9router #4216)
// and request timing (#4193). Both SQLite and PostgreSQL feed the same JS
// aggregation, so these exercise it directly: the category columns must add up
// to the bucket's recorded cost on every dimension.
import { describe, expect, it, vi } from "vitest";
import { calculateCostBreakdown } from "open-sse/providers/pricing.js";
import { addCostSplit, addLatency, aggregateEntryToDay, applyCostBreakdowns } from "@/lib/db/repos/usageRepo.js";
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

describe("aggregateEntryToDay account buckets", () => {
  const entry = (model, cost) => ({ provider: "openai", model, connectionId: "conn-1", tokens: { prompt_tokens: 10, completion_tokens: 5 }, cost });

  it("keeps one counter per connection and model", () => {
    const day = {};
    aggregateEntryToDay(day, entry("a", 0.1));
    aggregateEntryToDay(day, entry("b", 0.4));
    aggregateEntryToDay(day, entry("a", 0.1));

    const a = day.byAccount["conn-1|a|openai"];
    const b = day.byAccount["conn-1|b|openai"];
    expect(a).toMatchObject({ requests: 2, connectionId: "conn-1", rawModel: "a" });
    expect(a.cost).toBeCloseTo(0.2, 12);
    expect(b).toMatchObject({ requests: 1, connectionId: "conn-1", rawModel: "b" });
    expect(b.cost).toBeCloseTo(0.4, 12);
  });
});

describe("addCostSplit", () => {
  const split = (inputCost, outputCost) => ({ inputCost, cachedCost: 0, cacheCreationCost: 0, outputCost, reasoningCost: 0 });

  it("sums stored splits and parks rows without one in the remainder", () => {
    const target = {};
    addCostSplit(target, { promptTokens: 10, completionTokens: 5, cost: 3, ...split(1, 2) });
    addCostSplit(target, { promptTokens: 7, completionTokens: 1, cost: 0.5, inputCost: null });
    expect(target).toMatchObject({ inputCost: 1, outputCost: 2 });
    expect(target.unsplit).toMatchObject({ promptTokens: 7, completionTokens: 1, cost: 0.5 });
  });

  it("moves a counter summed before splits existed into the remainder", () => {
    const counter = { requests: 2, promptTokens: 40, completionTokens: 20, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0.8 };
    addCostSplit(counter, { cost: 1, ...split(0.25, 0.75) });
    expect(counter.unsplit).toMatchObject({ promptTokens: 40, completionTokens: 20, cost: 0.8 });
    expect(counter.inputCost).toBe(0.25);
  });
});

describe("applyCostBreakdowns", () => {
  const lookup = async (provider, model) => ({ cheap, dear }[model] || null);
  const tiered = { ...cheap, longContextThreshold: 500, longContextInputMultiplier: 2, longContextOutputMultiplier: 1.5 };

  it("publishes the stored per-request split of tiered traffic, not base ratios", async () => {
    // One request above the tier, one below, priced where each tier was known.
    const big = calculateCostBreakdown({ prompt_tokens: 900, completion_tokens: 100 }, tiered);
    const small = calculateCostBreakdown({ prompt_tokens: 100, completion_tokens: 400 }, tiered);
    const day = {};
    for (const [tokens, parts] of [[{ prompt_tokens: 900, completion_tokens: 100 }, big], [{ prompt_tokens: 100, completion_tokens: 400 }, small]]) {
      aggregateEntryToDay(day, { provider: "openai", model: "tiered", tokens, cost: parts.totalCost, ...parts });
    }
    const stats = emptyStats();
    const counter = day.byModel["tiered|openai"];
    stats.byModel.m = { cost: 0, rawModel: "tiered", rawProvider: "openai" };
    addCostSplit(stats.byModel.m, counter);
    stats.byModel.m.cost = counter.cost;
    await applyCostBreakdowns(stats, async () => tiered);

    expect(stats.byModel.m.inputCost).toBeCloseTo(big.inputCost + small.inputCost, 15);
    expect(stats.byModel.m.outputCost).toBeCloseTo(big.outputCost + small.outputCost, 15);
    expect(stats.byModel.m.unsplit).toBeUndefined();
  });

  it("keeps the stored split and reports an unpriceable tiered remainder as not split", async () => {
    const stats = emptyStats();
    stats.byModel.m = bucket({ cost: 1.5, rawModel: "tiered", rawProvider: "openai", inputCost: 0.1, cachedCost: 0, cacheCreationCost: 0, outputCost: 0.4, reasoningCost: 0, unsplit: { ...bucket(), cost: 1 } });
    await applyCostBreakdowns(stats, async () => tiered);
    expect(stats.byModel.m).toMatchObject({ inputCost: 0.1, outputCost: 0.4, unsplitCost: 1 });
    expect(splitSum(stats.byModel.m) + stats.byModel.m.unsplitCost).toBeCloseTo(1.5, 12);
  });

  it("prices unsplit rows of an untiered model and adds the stored split", async () => {
    const stats = emptyStats();
    stats.byModel.m = bucket({ cost: 1.5, rawModel: "dear", rawProvider: "openai", inputCost: 0.1, cachedCost: 0, cacheCreationCost: 0, outputCost: 0.4, reasoningCost: 0, unsplit: { ...bucket(), cost: 1 } });
    await applyCostBreakdowns(stats, lookup);
    expect(splitSum(stats.byModel.m)).toBeCloseTo(1.5, 12);
    // Remainder at dear rates: 800 fresh * 10, 200 cached * 1, 500 output * 40.
    expect(stats.byModel.m.inputCost).toBeCloseTo(0.1 + 8000 / 28200, 12);
  });

  it("does not price a legacy account blob that may mix models", async () => {
    const stats = emptyStats();
    stats.byAccount.a = bucket({ cost: 1, rawModel: "dear", rawProvider: "openai", unsplit: { ...bucket(), cost: 1, mixed: true } });
    await applyCostBreakdowns(stats, lookup);
    expect(stats.byAccount.a).toMatchObject({ inputCost: 0, outputCost: 0, unsplitCost: 1 });
  });

  it("carries a model's unsplit cost into its provider's columns", async () => {
    const stats = emptyStats();
    stats.byProvider.openai = bucket({ cost: 3 });
    stats.byModel.priced = bucket({ cost: 1, rawModel: "cheap", rawProvider: "openai", inputCost: 0.5, cachedCost: 0, cacheCreationCost: 0, outputCost: 0.5, reasoningCost: 0 });
    // A provider-reported cost with no tokens to price it by.
    stats.byModel.reported = { requests: 1, promptTokens: 0, completionTokens: 0, cost: 2, rawModel: "cheap", rawProvider: "openai", unsplit: { promptTokens: 0, completionTokens: 0, cost: 2 } };
    await applyCostBreakdowns(stats, lookup);

    expect(stats.byModel.reported).toMatchObject({ inputCost: 0, unsplitCost: 2 });
    expect(stats.byProvider.openai).toMatchObject({ inputCost: 0.5, outputCost: 0.5, unsplitCost: 2 });
  });

  it("sums provider columns from its models when every model is split", async () => {
    const stats = emptyStats();
    stats.byProvider.openai = bucket({ cost: 3 });
    stats.byModel.a = bucket({ cost: 1, rawModel: "cheap", rawProvider: "openai", inputCost: 0.5, cachedCost: 0, cacheCreationCost: 0, outputCost: 0.5, reasoningCost: 0 });
    stats.byModel.b = bucket({ cost: 2, rawModel: "dear", rawProvider: "openai", unsplit: { ...bucket(), cost: 2 } });
    await applyCostBreakdowns(stats, lookup);
    expect(splitSum(stats.byProvider.openai)).toBeCloseTo(3, 12);
  });

  it("logs a failed pricing lookup and retries it instead of caching no pricing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn()
      .mockRejectedValueOnce(new Error("db locked"))
      .mockResolvedValue(cheap);
    const stats = emptyStats();
    stats.byModel.m = bucket({ cost: 1, rawModel: "cheap", rawProvider: "openai", unsplit: { ...bucket(), cost: 1 } });
    stats.byEndpoint.e = bucket({ cost: 1, rawModel: "cheap", rawProvider: "openai", unsplit: { ...bucket(), cost: 1 } });
    await applyCostBreakdowns(stats, failing);

    expect(errorSpy).toHaveBeenCalled();
    expect(stats.byModel.m.unsplitCost).toBe(1);
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
