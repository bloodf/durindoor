// Review follow-up for the per-rate usage cost split (upstream 9router #4216):
// the split is stored per request at insert, so long-context tiers land in the
// right category, and daily account buckets keep one counter per model, so a
// 7-day account row matches what today/24h shows for the same traffic.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { calculateCostBreakdown, getPricingForModel } from "open-sse/providers/pricing.js";

const originalDataDir = process.env.DATA_DIR;
const now = new Date(2026, 6, 10, 12, 0, 0, 0);
// Built-in rates: 2x input and 1.5x output above 272k input tokens.
const tiered = getPricingForModel("openai", "gpt-6-astra");
const flat = { input: 3, output: 5 };
const bigTokens = { prompt_tokens: 300000, completion_tokens: 100 };
const smallTokens = { prompt_tokens: 100, completion_tokens: 400 };
const flatTokens = { prompt_tokens: 50, completion_tokens: 50 };
let tempDir;
let db;

function at(daysAgo, hour) {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function save(timestamp, model, tokens) {
  return db.saveRequestUsage({ timestamp, provider: "openai", model, connectionId: "conn-1", endpoint: "/v1/chat/completions", tokens, status: "ok" });
}

const rowFor = (group, model) => Object.values(group).filter((entry) => entry.rawModel === model);

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-usage-split-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updatePricing({ openai: { "gpt-flat": flat } });
  for (const daysAgo of [0, 1]) {
    await save(at(daysAgo, 9), "gpt-6-astra", bigTokens);
    await save(at(daysAgo, 10), "gpt-6-astra", smallTokens);
    await save(at(daysAgo, 11), "gpt-flat", flatTokens);
  }
});

afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("stored per-request cost split", () => {
  const big = calculateCostBreakdown(bigTokens, tiered);
  const small = calculateCostBreakdown(smallTokens, tiered);

  it.each([["today", 1], ["7d", 2]])("keeps tiered categories exact for %s", async (period, days) => {
    const stats = await db.getUsageStats(period);
    const [model] = rowFor(stats.byModel, "gpt-6-astra");
    expect(model.inputCost).toBeCloseTo(days * (big.inputCost + small.inputCost), 12);
    expect(model.outputCost).toBeCloseTo(days * (big.outputCost + small.outputCost), 12);
    expect(model.unsplit).toBeUndefined();
  });

  it.each(["today", "7d"])("gives each model its own account row for %s", async (period) => {
    const stats = await db.getUsageStats(period);
    for (const model of ["gpt-6-astra", "gpt-flat"]) {
      const accounts = rowFor(stats.byAccount, model);
      const [byModel] = rowFor(stats.byModel, model);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].requests).toBe(byModel.requests);
      expect(accounts[0].cost).toBeCloseTo(byModel.cost, 15);
      expect(accounts[0].inputCost).toBeCloseTo(byModel.inputCost, 15);
    }
    const provider = stats.byProvider.openai;
    const columns = provider.inputCost + provider.cachedCost + provider.cacheCreationCost + provider.outputCost + provider.reasoningCost;
    expect(columns).toBeCloseTo(provider.cost, 15);
  });

  it("prices legacy rows where that is exact and withholds the split where it is not", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const legacyCost = (tokens, pricing) => calculateCostBreakdown(tokens, pricing).totalCost;
    const counter = (tokens, pricing, meta) => ({ requests: 1, promptTokens: tokens.prompt_tokens, completionTokens: tokens.completion_tokens, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: legacyCost(tokens, pricing), ...meta });
    const flatMeta = { rawModel: "gpt-flat", provider: "openai" };
    const tieredMeta = { rawModel: "gpt-6-astra", provider: "openai" };
    // A day saved before splits were stored: no cost columns, account keyed by bare connection id.
    const legacyDay = {
      requests: 2, promptTokens: 0, completionTokens: 0, cost: 0,
      byProvider: {},
      byModel: { "gpt-flat|openai": counter(flatTokens, flat, flatMeta), "gpt-6-astra|openai": counter(bigTokens, tiered, tieredMeta) },
      byAccount: { "conn-1": counter(flatTokens, flat, flatMeta) },
      byApiKey: {}, byEndpoint: {},
    };
    const day = new Date(at(3, 12));
    const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    adapter.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, JSON.stringify(legacyDay)]);

    const stats = await db.getUsageStats("7d");
    const [flatModel] = rowFor(stats.byModel, "gpt-flat");
    const [tieredModel] = rowFor(stats.byModel, "gpt-6-astra");
    const [flatAccount] = rowFor(stats.byAccount, "gpt-flat");
    const [tieredAccount] = rowFor(stats.byAccount, "gpt-6-astra");

    // No tier: the legacy remainder prices exactly, so the columns still sum.
    const flatColumns = flatModel.inputCost + flatModel.cachedCost + flatModel.cacheCreationCost + flatModel.outputCost + flatModel.reasoningCost;
    expect(flatColumns).toBeCloseTo(flatModel.cost, 15);
    // Unequal tier multipliers: summed legacy tokens cannot be split correctly.
    expect(tieredModel.inputCost).toBeUndefined();
    // A bare-connection blob may hold several models, so its row is not split.
    expect(flatAccount.inputCost).toBeUndefined();
    expect(tieredAccount.inputCost).toBeCloseTo(2 * (big.inputCost + small.inputCost), 12);
  });
});
