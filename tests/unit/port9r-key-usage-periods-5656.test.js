// Port of decolua/9router #5656: per-API-key limits for cost and tokens over
// day, week and month. DurinDoor already enforced day and month token limits
// and a monthly budget; this adds the weekly window (Monday start) and a daily
// budget on the same ID-scoped usageHistory ledger and policy storage.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let limits;
let policyHelper;

// Local-time fixtures. 2026-11-18 is a Wednesday; its week began Monday the 16th.
const WED_NOON = new Date(2026, 10, 18, 12, 0, 0);
const SUN_NOON = new Date(2026, 10, 22, 12, 0, 0);
const MON_MIDNIGHT = new Date(2026, 10, 16, 0, 0, 0);
const at = (...args) => new Date(...args).toISOString();

async function insertUsage(key, { input = 0, output = 0, cost = 0, timestamp }) {
  const adapter = await db.getAdapter();
  adapter.run(
    `INSERT INTO usageHistory(timestamp, provider, model, apiKey, apiKeyId, promptTokens, completionTokens, cost, status) VALUES(?, 'openai', 'gpt-test', ?, ?, ?, ?, ?, 'ok')`,
    [timestamp, key.key, key.id, input, output, cost]
  );
  db.statsEmitter.emit("apiKeyUsage", key.key, 0, key.id);
}

async function keyWithPolicy(name, policy) {
  const created = await db.createApiKey(name, "machine-1", [], null, null, { policy });
  return db.getApiKeyByKey(created.key);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-key-periods-5656-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  const dbIndex = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  db = { ...dbIndex, getAdapter };
  limits = await import("@/lib/apiKeyLimits.js");
  policyHelper = await import("@/lib/db/helpers/apiKeyPolicy.js");
});

afterAll(async () => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("weekly and daily-budget policy fields", () => {
  it("normalizes the new fields like the existing windows", () => {
    expect(policyHelper.normalizeApiKeyPolicy({ dailyBudget: "1.5", weeklyBudget: 0, weeklyTokenLimit: "100", weeklyInputTokenLimit: "" }))
      .toEqual({ dailyBudget: 1.5, weeklyTokenLimit: 100 });
    expect(() => policyHelper.normalizeApiKeyPolicy({ weeklyTokenLimit: 1.5 })).toThrow(/weeklyTokenLimit must be a non-negative integer/);
    expect(() => policyHelper.normalizeApiKeyPolicy({ weeklyBudget: -1 })).toThrow(/weeklyBudget must be a non-negative number/);
    expect(() => policyHelper.normalizeApiKeyPolicy({ dailyBudget: "abc" })).toThrow(/dailyBudget/);
    expect(policyHelper.API_KEY_LIMIT_FIELDS).toEqual(expect.arrayContaining(["dailyBudget", "weeklyTokenLimit", "weeklyInputTokenLimit", "weeklyOutputTokenLimit", "weeklyBudget"]));
  });
});

describe("weekly window", () => {
  it("counts from Monday local midnight and excludes the previous Sunday", async () => {
    const key = await keyWithPolicy("week-total", { weeklyTokenLimit: 100 });
    await insertUsage(key, { input: 500, output: 500, timestamp: at(2026, 10, 15, 23, 0) }); // Sunday before
    await insertUsage(key, { input: 40, output: 30, timestamp: at(2026, 10, 16, 0, 30) }); // Monday
    expect(await limits.checkApiKeyLimits(key, WED_NOON)).toBeNull();

    await insertUsage(key, { input: 20, output: 10, timestamp: at(2026, 10, 17, 9, 0) });
    const blocked = await limits.checkApiKeyLimits(key, WED_NOON);
    expect(blocked.message).toMatch(/weekly tokens limit reached \(100\/100\)\. Resets at local midnight on Monday/);
    // Wednesday noon -> next Monday 00:00 is 4.5 days.
    expect(blocked.retryAfter).toBe(Math.ceil(4.5 * 24 * 3600));
  });

  it("enforces weekly input and output limits independently", async () => {
    const input = await keyWithPolicy("week-in", { weeklyInputTokenLimit: 50 });
    await insertUsage(input, { input: 50, output: 0, timestamp: at(2026, 10, 17, 9, 0) });
    expect((await limits.checkApiKeyLimits(input, WED_NOON)).message).toMatch(/weekly input tokens limit/);

    const output = await keyWithPolicy("week-out", { weeklyOutputTokenLimit: 50 });
    await insertUsage(output, { input: 9999, output: 49, timestamp: at(2026, 10, 17, 9, 0) });
    expect(await limits.checkApiKeyLimits(output, WED_NOON)).toBeNull();
    await insertUsage(output, { output: 1, timestamp: at(2026, 10, 17, 10, 0) });
    expect((await limits.checkApiKeyLimits(output, WED_NOON)).message).toMatch(/weekly output tokens limit/);
  });

  it("enforces the weekly budget and resets at the Monday boundary", async () => {
    const key = await keyWithPolicy("week-budget", { weeklyBudget: 2 });
    await insertUsage(key, { cost: 1.25, timestamp: at(2026, 10, 15, 23, 59) }); // Sunday, previous week
    await insertUsage(key, { cost: 2, timestamp: at(2026, 10, 16, 8, 0) });
    expect((await limits.checkApiKeyLimits(key, SUN_NOON)).message).toMatch(/weekly budget limit reached \(\$2\.00\/\$2\.00\)/);
    // Sunday noon -> Monday 00:00 is 12 hours away.
    expect((await limits.checkApiKeyLimits(key, SUN_NOON)).retryAfter).toBe(12 * 3600);

    // Exactly at Monday 00:00 of the following week only the new week counts.
    const nextMonday = new Date(2026, 10, 23, 0, 0, 0);
    expect(await limits.checkApiKeyLimits(key, nextMonday)).toBeNull();
    // And Monday midnight itself starts a fresh week relative to Sunday usage.
    const monKey = await keyWithPolicy("week-edge", { weeklyBudget: 1 });
    await insertUsage(monKey, { cost: 5, timestamp: at(2026, 10, 15, 23, 59, 59) });
    expect(await limits.checkApiKeyLimits(monKey, MON_MIDNIGHT)).toBeNull();
  });
});

describe("daily budget", () => {
  it("counts cost since local midnight only", async () => {
    const key = await keyWithPolicy("day-budget", { dailyBudget: 1 });
    await insertUsage(key, { cost: 9, timestamp: at(2026, 10, 17, 23, 0) }); // yesterday
    await insertUsage(key, { cost: 0.75, timestamp: at(2026, 10, 18, 1, 0) });
    expect(await limits.checkApiKeyLimits(key, WED_NOON)).toBeNull();
    await insertUsage(key, { cost: 0.25, timestamp: at(2026, 10, 18, 2, 0) });
    const blocked = await limits.checkApiKeyLimits(key, WED_NOON);
    expect(blocked.message).toMatch(/daily budget limit reached \(\$1\.00\/\$1\.00\)\. Resets at local midnight\./);
    expect(blocked.retryAfter).toBe(12 * 3600);
  });
});

describe("status and ledger", () => {
  it("reports week usage in the dashboard status and keeps usage scoped to the key id", async () => {
    const key = await keyWithPolicy("status", { weeklyTokenLimit: 1000, dailyBudget: 3 });
    const other = await keyWithPolicy("other", { weeklyTokenLimit: 1000 });
    await insertUsage(key, { input: 10, output: 5, cost: 0.5, timestamp: at(2026, 10, 18, 1, 0) });
    await insertUsage(other, { input: 700, timestamp: at(2026, 10, 18, 1, 0) });

    const status = await limits.getApiKeyLimitStatus(key, WED_NOON);
    const byField = Object.fromEntries(status.limits.map((l) => [l.field, l]));
    expect(byField.weeklyTokenLimit).toMatchObject({ used: 15, limit: 1000 });
    expect(byField.dailyBudget).toMatchObject({ used: 0.5, limit: 3, money: true, always: true });
    expect(byField.weeklyBudget).toMatchObject({ limit: null, money: true, always: true });
    expect(new Date(byField.weeklyTokenLimit.resetAt)).toEqual(new Date(2026, 10, 23));
    expect(status.week.requests).toBe(1);
  });

  it("returns the week window only when a week start is requested", async () => {
    const key = await keyWithPolicy("shape", null);
    await insertUsage(key, { input: 1, timestamp: at(2026, 10, 17, 1, 0) });
    const legacy = await db.getApiKeyWindowUsageTotals(key.key, at(2026, 10, 18), at(2026, 10, 1), key.id);
    expect(Object.keys(legacy)).toEqual(["day", "month"]);
    const withWeek = await db.getApiKeyWindowUsageTotals(key.key, at(2026, 10, 18), at(2026, 10, 1), key.id, at(2026, 10, 16));
    expect(withWeek.day.inputTokens).toBe(0);
    expect(withWeek.week.inputTokens).toBe(1);
    expect(withWeek.month.inputTokens).toBe(1);
  });

  it("includes a week that starts before the month in the scan", async () => {
    const key = await keyWithPolicy("cross-month", { weeklyTokenLimit: 10 });
    // Week of Mon 2026-11-30 .. Sun 12-06; Wednesday 12-02 noon. Month starts 12-01.
    await insertUsage(key, { input: 10, timestamp: at(2026, 10, 30, 12, 0) });
    const blocked = await limits.checkApiKeyLimits(key, new Date(2026, 11, 2, 12, 0, 0));
    expect(blocked.message).toMatch(/weekly tokens limit reached/);
  });
});
