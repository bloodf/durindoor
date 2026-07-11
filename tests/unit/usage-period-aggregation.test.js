import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const now = new Date(2026, 6, 10, 12, 0, 0, 0);
let tempDir;
let db;
let seeded = false;
const timestamps = [];

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-usage-periods-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function localTimestamp(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
  return new Date(year, month - 1, day, hour, minute, second, ms).toISOString();
}

async function seed() {
  if (seeded) return;
  seeded = true;
  await db.updatePricing({
    openai: { "gpt-period": { input: 1, output: 2, cached: 0.5, reasoning: 3 } },
  });
  const entries = [
    localTimestamp(2026, 7, 10, 10),
    localTimestamp(2026, 7, 10, 0),
    localTimestamp(2026, 7, 9, 13),
    localTimestamp(2026, 7, 9, 12),
    localTimestamp(2026, 7, 9, 11, 59, 59, 999),
    localTimestamp(2026, 7, 9, 11),
    localTimestamp(2026, 7, 4, 0),
    localTimestamp(2026, 7, 3, 23, 59, 59, 999),
    localTimestamp(2026, 4, 12, 0),
    localTimestamp(2026, 4, 11, 23, 59, 59, 999),
    localTimestamp(2026, 1, 12, 0),
    localTimestamp(2026, 1, 11, 23, 59, 59, 999),
    localTimestamp(2025, 7, 11, 0),
    localTimestamp(2025, 7, 10, 23, 59, 59, 999),
    localTimestamp(2024, 2, 29, 8),
    new Date(now.getTime() + 1).toISOString(),
    localTimestamp(2026, 7, 11, 0),
  ];
  for (const [index, timestamp] of entries.entries()) {
    timestamps.push(new Date(timestamp).getTime());
    await db.saveRequestUsage({
      timestamp,
      provider: "openai",
      model: "gpt-period",
      connectionId: "connection-period",
      endpoint: "/v1/chat/completions",
      tokens: {
        prompt_tokens: 10 + index,
        completion_tokens: 5,
        cached_tokens: 2,
        reasoning_tokens: 3,
        cache_creation_input_tokens: 1,
      },
      status: "ok",
    });
  }
}

function expectedCount(period) {
  const nowMs = now.getTime();
  let cutoff = -Infinity;
  if (period === "today") {
    const start = new Date(now); start.setHours(0, 0, 0, 0); cutoff = start.getTime();
  } else if (period === "24h") {
    cutoff = nowMs - 86400000;
  } else if (period !== "all") {
    const days = Number.parseInt(period, 10);
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days + 1); cutoff = start.getTime();
  }
  return timestamps.filter((timestamp) => timestamp >= cutoff && timestamp <= nowMs).length;
}

function sumRequests(group) {
  return Object.values(group).reduce((total, entry) => total + entry.requests, 0);
}

describe("usage period aggregation", () => {
  it("returns a small deterministic empty all-time series", async () => {
    const stats = await db.getUsageStats("all");
    const chart = await db.getChartData("all");
    expect(stats.totalRequests).toBe(0);
    expect(chart).toHaveLength(7);
    expect(chart.every((point) => point.tokens === 0 && point.cost === 0)).toBe(true);
  });

  it("includes exact calendar cutoffs and excludes future rows for every period", async () => {
    await seed();
    for (const period of ["today", "24h", "7d", "30d", "60d", "90d", "180d", "365d", "all"]) {
      const stats = await db.getUsageStats(period);
      expect(stats.totalRequests, period).toBe(expectedCount(period));
      expect(sumRequests(stats.byProvider), `${period}:provider`).toBe(stats.totalRequests);
      expect(sumRequests(stats.byModel), `${period}:model`).toBe(stats.totalRequests);
      expect(sumRequests(stats.byAccount), `${period}:account`).toBe(stats.totalRequests);
      expect(sumRequests(stats.byApiKey), `${period}:apiKey`).toBe(stats.totalRequests);
      expect(sumRequests(stats.byEndpoint), `${period}:endpoint`).toBe(stats.totalRequests);
    }
  });

  it("keeps stats and chart token-detail and cost totals equal", async () => {
    await seed();
    for (const period of ["today", "24h", "7d", "90d", "365d", "all"]) {
      const stats = await db.getUsageStats(period);
      const chart = await db.getChartData(period);
      const totals = chart.reduce((result, point) => ({
        tokens: result.tokens + point.tokens,
        cached: result.cached + point.cachedTokens,
        reasoning: result.reasoning + point.reasoningTokens,
        cacheCreation: result.cacheCreation + point.cacheCreationTokens,
        cost: result.cost + point.cost,
      }), { tokens: 0, cached: 0, reasoning: 0, cacheCreation: 0, cost: 0 });
      expect(totals.tokens, period).toBe(stats.totalPromptTokens + stats.totalCompletionTokens);
      expect(totals.cached, period).toBe(stats.totalCachedTokens);
      expect(totals.reasoning, period).toBe(stats.totalReasoningTokens);
      expect(totals.cacheCreation, period).toBe(stats.totalCacheCreationTokens);
      expect(totals.cost, period).toBeCloseTo(stats.totalCost, 10);
      expect(stats.totalCost, period).toBeGreaterThan(0);
    }
  });

  it("distinguishes server-local today from rolling 24h", async () => {
    await seed();
    expect((await db.getUsageStats("24h")).totalRequests).toBeGreaterThan(
      (await db.getUsageStats("today")).totalRequests,
    );
  });

  it("zero-fills and deterministically coarsens sparse multi-year all-time data", async () => {
    await seed();
    const chart = await db.getChartData("all");
    expect(chart.length).toBeLessThanOrEqual(366);
    expect(chart[0].label).toContain("2024");
    expect(chart.at(-1).label).toContain("2026");
    expect(chart.reduce((sum, point) => sum + point.tokens, 0)).toBe(
      (await db.getUsageStats("all")).totalPromptTokens + (await db.getUsageStats("all")).totalCompletionTokens,
    );
  });

  it("rejects invalid direct repository periods", async () => {
    await expect(db.getUsageStats("bogus")).rejects.toThrow("Invalid usage period");
    await expect(db.getChartData("bogus")).rejects.toThrow("Invalid usage period");
  });

  it("uses fixed query count and grouped history for all-time lastUsed", async () => {
    await seed();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const originalAll = adapter.all.bind(adapter);
    const statements = [];
    adapter.all = (sql, params) => { statements.push(sql); return originalAll(sql, params); };
    try {
      await db.getUsageStats("all");
    } finally {
      adapter.all = originalAll;
    }
    expect(statements.length).toBeLessThan(20);
    const historyOverlay = statements.find((sql) => sql.includes("MAX(timestamp) AS timestamp"));
    expect(historyOverlay).toContain("GROUP BY");
    expect(historyOverlay).toContain("timestamp <= ?");
  });

  it("keeps compatible totals for legacy rollups while additive detail defaults to zero", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const legacy = {
      requests: 1,
      promptTokens: 20,
      completionTokens: 10,
      cachedTokens: 4,
      cost: 1.25,
      byProvider: { legacy: { requests: 1, promptTokens: 20, completionTokens: 10, cachedTokens: 4, cost: 1.25 } },
      byModel: { "legacy-model|legacy": { requests: 1, promptTokens: 20, completionTokens: 10, cachedTokens: 4, cost: 1.25, rawModel: "legacy-model", provider: "legacy" } },
      byAccount: {},
      byApiKey: {},
      byEndpoint: { "Unknown|legacy-model|legacy": { requests: 1, promptTokens: 20, completionTokens: 10, cachedTokens: 4, cost: 1.25, endpoint: "Unknown", rawModel: "legacy-model", provider: "legacy" } },
    };
    adapter.run(
      `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`,
      ["2023-01-01", JSON.stringify(legacy)],
    );

    const stats = await db.getUsageStats("all");
    expect(stats.byProvider.legacy).toMatchObject({
      requests: 1,
      promptTokens: 20,
      completionTokens: 10,
      cachedTokens: 4,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cost: 1.25,
    });
  });

  it("rebuilds the partial cutoff day after a reset without stale rollup totals", async () => {
    await seed();
    await db.resetUsageHistory("1h");

    const stats = await db.getUsageStats("today");
    const chart = await db.getChartData("today");
    expect(stats.totalRequests).toBe(0);
    expect(chart.reduce((sum, point) => sum + point.tokens, 0)).toBe(0);
  });
});
