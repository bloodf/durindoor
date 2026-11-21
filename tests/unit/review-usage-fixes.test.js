import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateCostBreakdown, calculateCostFromTokens } from "../../open-sse/providers/pricing.js";
import { mediaAccounting } from "../../open-sse/handlers/mediaAccounting.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let oldDataDir;
let dir;
let repo;
let db;

beforeEach(async () => {
  oldDataDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-usage-fixes-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await import("@/lib/db/index.js");
  repo = await import("@/lib/db/repos/usageRepo.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {}
  delete global._dbAdapter;
  delete global._statsEmitTimers;
  if (oldDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = oldDataDir;
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("#2170 xAI cost_in_usd_ticks divisor (1 USD = 1e10 ticks)", () => {
  it("converts xAI cost_in_usd_ticks at 1e10 ticks per USD in pricing helpers", () => {
    const pricing = { input: 3, output: 15 };
    expect(
      calculateCostBreakdown({ prompt_tokens: 100, completion_tokens: 50, cost_in_usd_ticks: 37_756_000 }, pricing)
    ).toEqual({
      inputCost: 0,
      cachedCost: 0,
      cacheCreationCost: 0,
      outputCost: 0,
      reasoningCost: 0,
      totalCost: 0.0037756,
    });
    expect(
      calculateCostFromTokens({ prompt_tokens: 100, completion_tokens: 50, cost_in_usd_ticks: 10_000_000_000 }, pricing)
    ).toBe(1);
  });

  it("converts xAI cost_in_usd_ticks at 1e10 ticks per USD in mediaAccounting", () => {
    const acc = mediaAccounting(
      { usage: { input_tokens: 10, output_tokens: 5, cost_in_usd_ticks: 37_756_000 } },
      "xai",
      "image"
    );
    expect(acc.cost).toBeCloseTo(0.0037756, 10);
    expect(acc.costStatus).toBe("known");
    expect(acc.costSource).toBe("provider");
  });

  it("persists xAI cost_in_usd_ticks at 1e10 ticks per USD in usageRepo", async () => {
    await repo.saveRequestUsage({
      timestamp: NOW.toISOString(),
      provider: "xai",
      model: "grok-4",
      connectionId: "conn-xai",
      endpoint: "/v1/chat/completions",
      tokens: {
        prompt_tokens: 100,
        completion_tokens: 50,
        cost_in_usd_ticks: 37_756_000,
      },
      status: "ok",
    });

    const row = db.get("SELECT cost, meta FROM usageHistory");
    expect(row.cost).toBeCloseTo(0.0037756, 10);
    expect(JSON.parse(row.meta)).toMatchObject({
      costStatus: "known",
      costSource: "provider",
    });
  });
});

describe("#2173 usage reset for a period deletes only the selected recent window", () => {
  it("deletes rows newer than now - period while preserving older history, boundary-day rollups, usageLastSeen, and token-saver stats", async () => {
    const t5d = new Date(NOW.getTime() - 5 * DAY).toISOString();
    const t2h = new Date(NOW.getTime() - 2 * HOUR).toISOString();
    const t10m = new Date(NOW.getTime() - 10 * MIN).toISOString();

    for (const [tag, ts, promptTokens, cost] of [
      ["old-5d", t5d, 10, 0.1],
      ["older-today-2h", t2h, 20, 0.2],
      ["recent-10m", t10m, 40, 0.4],
    ]) {
      await repo.saveRequestUsage({
        timestamp: ts,
        provider: "xai",
        model: "grok-4",
        connectionId: "conn-1",
        apiKey: "sk-test-reset",
        endpoint: "/v1/chat/completions",
        usageEventId: `evt-${tag}`,
        tokens: { prompt_tokens: promptTokens, completion_tokens: 5 },
        cost,
        costStatus: "known",
        costSource: "provider",
        status: "ok",
      });
      await repo.recordTokenSaverEvent(
        {
          rtk: { hits: 1, requestsWithHits: 1, bytesBefore: 200, bytesAfter: 100, bytesSaved: 100 },
          headroom: { state: "skipped", diagnostic: "timeout" },
        },
        new Date(ts)
      );
    }

    await repo.resetUsageHistory("1h");

    const remainingRows = db.all("SELECT timestamp, promptTokens, cost FROM usageHistory ORDER BY timestamp ASC");
    expect(remainingRows).toEqual([
      { timestamp: t5d, promptTokens: 10, cost: 0.1 },
      { timestamp: t2h, promptTokens: 20, cost: 0.2 },
    ]);

    const todayKey = NOW.toISOString().slice(0, 10);
    const todayDaily = JSON.parse(db.get("SELECT data FROM usageDaily WHERE dateKey = ?", [todayKey]).data);
    expect(todayDaily).toMatchObject({
      requests: 1,
      promptTokens: 20,
      completionTokens: 5,
      cost: 0.2,
    });

    const lastSeen = db.all("SELECT dateKey, lastUsed FROM usageLastSeen ORDER BY dateKey ASC");
    expect(lastSeen).toEqual([
      { dateKey: t5d.slice(0, 10), lastUsed: t5d },
      { dateKey: t2h.slice(0, 10), lastUsed: t2h },
    ]);

    const allStats = await repo.getUsageStats("all");
    expect(allStats.totalRequests).toBe(2);
    expect(allStats.totalPromptTokens).toBe(30);
    expect(allStats.totalCost).toBeCloseTo(0.3, 10);
    expect(allStats.byModel["grok-4 (xai)"].lastUsed).toBe(t2h);

    const todayStats = await repo.getUsageStats("today");
    expect(todayStats.totalRequests).toBe(1);
    expect(todayStats.totalPromptTokens).toBe(20);
    expect(todayStats.totalCost).toBeCloseTo(0.2, 10);

    const tokenSaverAll = await repo.getTokenSaverStats("all", NOW);
    expect(tokenSaverAll.requestsObserved).toBe(2);
    expect(tokenSaverAll.rtk.bytesSaved).toBe(200);
    expect(tokenSaverAll.headroom.skipReasons.timeout).toBe(2);

    const lifetime = db.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'");
    expect(lifetime.value).toBe("2");
  });

  it("deletes daily rollups after a multi-day reset cutoff and rebuilds the boundary day", async () => {
    const t5d = new Date(NOW.getTime() - 5 * DAY).toISOString();
    const t30h = new Date(NOW.getTime() - 30 * HOUR).toISOString();
    const t20h = new Date(NOW.getTime() - 20 * HOUR).toISOString();
    const t10m = new Date(NOW.getTime() - 10 * MIN).toISOString();

    for (const [ts, promptTokens] of [
      [t5d, 10],
      [t30h, 20],
      [t20h, 30],
      [t10m, 40],
    ]) {
      await repo.saveRequestUsage({
        timestamp: ts,
        provider: "xai",
        model: "grok-4",
        connectionId: "conn-1",
        endpoint: "/v1/chat/completions",
        tokens: { prompt_tokens: promptTokens, completion_tokens: 5 },
        cost: 0.1,
        costStatus: "known",
        costSource: "provider",
        status: "ok",
      });
    }

    await repo.resetUsageHistory("1d");

    const remainingTimestamps = db.all("SELECT timestamp FROM usageHistory ORDER BY timestamp ASC").map((r) => r.timestamp);
    expect(remainingTimestamps).toEqual([t5d, t30h]);

    const dailyRows = db.all("SELECT dateKey, data FROM usageDaily ORDER BY dateKey ASC");
    expect(dailyRows.map((r) => r.dateKey)).toEqual([t5d.slice(0, 10), t30h.slice(0, 10)]);
    expect(JSON.parse(dailyRows[1].data)).toMatchObject({
      requests: 1,
      promptTokens: 20,
      completionTokens: 5,
    });
  });
});
