import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import migration from "../../src/lib/db/migrations/021-usage-last-seen.js";
import { getUsageCalendarCutoff } from "../../src/lib/usagePeriods.js";

const now = new Date("2026-09-20T12:00:00.000Z");
let dir, oldDataDir, repo, db;
beforeEach(async () => {
  oldDataDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-last-seen-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
  await import("@/lib/db/index.js");
  repo = await import("@/lib/db/repos/usageRepo.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  vi.useFakeTimers(); vi.setSystemTime(now);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter; delete global._statsEmitTimers;
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});
const entry = (timestamp, extra = {}) => ({ timestamp, provider: "provider", model: "model", tokens: { prompt_tokens: 2, completion_tokens: 3, cached_tokens: 4, reasoning_tokens: 5, cache_creation_input_tokens: 6 }, ...extra });
const expectedSummary = () => db.all(`SELECT SUBSTR(timestamp,1,10) AS dateKey, COALESCE(provider,'') AS provider, COALESCE(model,'') AS model, COALESCE(connectionId,'') AS connectionId, COALESCE(apiKey,'') AS apiKey, COALESCE(endpoint,'') AS endpoint, MAX(timestamp) AS lastUsed FROM usageHistory GROUP BY SUBSTR(timestamp,1,10), COALESCE(provider,''), COALESCE(model,''), COALESCE(connectionId,''), COALESCE(apiKey,''), COALESCE(endpoint,'') ORDER BY dateKey, provider, model, connectionId, apiKey, endpoint`);
const actualSummary = () => db.all("SELECT * FROM usageLastSeen ORDER BY dateKey, provider, model, connectionId, apiKey, endpoint");

it("keeps per-day maxima for nullable dimensions and out-of-order writes, matching the old overlay", async () => {
  for (const timestamp of ["2026-09-17T18:00:00.000Z", "2026-09-17T10:00:00.000Z", "2026-09-01T13:00:00.000Z"]) {
    for (const dimensions of [{}, { connectionId: "conn", apiKey: "secret", endpoint: "/chat" }, { model: "other", endpoint: "/responses" }]) await repo.saveRequestUsage(entry(timestamp, dimensions));
  }
  expect(actualSummary()).toEqual(expectedSummary());
  for (const period of ["all", "7d"]) {
    const stats = await repo.getUsageStats(period);
    const cutoff = period === "all" ? "" : getUsageCalendarCutoff(period, now).toISOString();
    const oracle = db.all("SELECT provider, model, MAX(timestamp) AS lastUsed FROM usageHistory WHERE timestamp >= ? AND timestamp <= ? GROUP BY provider, model", [cutoff, now.toISOString()]);
    expect(Object.values(stats.byModel).map(({ rawProvider: provider, rawModel: model, lastUsed }) => ({ provider, model, lastUsed })).sort((a,b)=>a.model.localeCompare(b.model))).toEqual(oracle.sort((a,b)=>a.model.localeCompare(b.model)));
  }
});

it("excludes a future row on the same UTC boundary day without losing the earlier row", async () => {
  await repo.saveRequestUsage(entry("2026-09-20T10:00:00.000Z"));
  await repo.saveRequestUsage(entry("2026-09-20T18:00:00.000Z"));
  await repo.saveRequestUsage(entry("2026-09-13T23:59:59.999Z", { model: "outside" }));
  for (const period of ["all", "7d"]) {
    const stats = await repo.getUsageStats(period);
    expect(stats.byModel["model (provider)"].lastUsed).toBe("2026-09-20T10:00:00.000Z");
    expect(stats.byModel["model (provider)"].requests).toBe(1);
  }
  const custom = await repo.getUsageStats("all", { startDate: "2026-09-13", endDate: "2026-09-13" });
  expect(custom.byModel["outside (provider)"].lastUsed).toBe("2026-09-13T23:59:59.999Z");
});

it("backfills existing history and scalar tokens idempotently without changing JSON", () => {
  db.exec("DROP TABLE usageLastSeen");
  for (const column of ["cachedTokens", "reasoningTokens", "cacheCreationTokens"]) db.exec(`ALTER TABLE usageHistory DROP COLUMN ${column}`);
  const tokens = JSON.stringify({ cached_tokens: 0, cache_read_input_tokens: 7, completion_tokens_details: { reasoning_tokens: 8 }, cache_creation_input_tokens: 9 });
  for (let i = 0; i < 503; i++) db.run("INSERT INTO usageHistory(timestamp, provider, model, tokens) VALUES(?, ?, ?, ?)", [`2026-09-${i % 2 ? "18" : "19"}T10:00:00.000Z`, "provider", i % 3 ? "model" : "other", tokens]);
  migration.up(db); migration.up(db);
  expect(actualSummary()).toEqual(expectedSummary());
  expect(db.get("SELECT SUM(cachedTokens) AS cached, SUM(reasoningTokens) AS reasoning, SUM(cacheCreationTokens) AS creation FROM usageHistory")).toEqual({ cached: 503 * 7, reasoning: 503 * 8, creation: 503 * 9 });
  expect(db.all("SELECT DISTINCT tokens FROM usageHistory")).toEqual([{ tokens }]);
  db.exec("DROP TABLE usageHistory");
  migration.up(db);
});

it("pages in insertion order with shared SQL filters, accurate totals, cap and masked secrets", async () => {
  for (let i = 0; i < 207; i++) await repo.saveRequestUsage(entry(`2026-09-19T10:${String(i % 60).padStart(2,"0")}:00.000Z`, { status: i % 2 ? "error" : "ok", apiKey: "secret-key", comboName: `row-${i}` }));
  await repo.saveRequestUsage(entry("2026-09-18T10:00:00.000Z", { provider: "other" }));
  const page = await repo.listUsageHistoryPage({ limit: 3, offset: 2, filters: { provider: "provider", model: "model", status: "error", startDate: "2026-09-19", endDate: "2026-09-20" } });
  expect(page.total).toBe(103);
  expect(page.rows.map(r=>r.comboName)).toEqual(["row-201", "row-199", "row-197"]);
  expect(page.rows[0]).not.toHaveProperty("apiKey");
  expect(page.rows[0].apiKeyMasked).not.toBe("secret-key");
  const capped = await repo.listUsageHistoryPage({ limit: 9999 });
  expect(capped.total).toBe(208); expect(capped.rows).toHaveLength(200);
  expect(await repo.listUsageHistoryPage({ offset: 9999 })).toEqual({ rows: [], total: 208 });
});

it("keeps summaries consistent with endpoint enrichment, pruning and reset", async () => {
  await repo.saveRequestUsage(entry("2026-09-17T09:00:00.000Z"));
  await repo.saveRequestUsage(entry("2026-09-17T10:00:00.000Z", { usageEventId: "event" }));
  await repo.saveRequestUsage(entry("2026-09-17T10:00:00.000Z", { usageEventId: "event", endpoint: "/chat" }));
  expect(actualSummary()).toEqual(expectedSummary());
  await repo.pruneUsageOlderThan(Date.parse("2026-09-17T09:30:00.000Z"));
  expect(actualSummary()).toEqual(expectedSummary());
  await repo.resetUsageHistory("all");
  expect(actualSummary()).toEqual([]);
});

it("sums grouped current-day statistics and exact chart bucket boundaries", async () => {
  for (const timestamp of ["2026-09-20T10:59:59.999Z", "2026-09-20T11:00:00.000Z", "2026-09-20T11:00:00.000Z"]) await repo.saveRequestUsage(entry(timestamp));
  for (const period of ["today", "24h", "7d"]) {
    const stats = await repo.getUsageStats(period);
    expect([stats.totalRequests, stats.totalPromptTokens, stats.totalCompletionTokens, stats.totalCachedTokens, stats.totalReasoningTokens, stats.totalCacheCreationTokens]).toEqual([3,6,9,12,15,18]);
  }
  const chart = await repo.getChartData("24h", "UTC");
  expect(chart.slice(-2).map(({tokens,cachedTokens})=>({tokens,cachedTokens}))).toEqual([{tokens:5,cachedTokens:4},{tokens:10,cachedTokens:8}]);
});

it("preserves the latest account model metadata across interleaved grouped rows", async () => {
  for (const model of ["first", "second", "first"]) await repo.saveRequestUsage(entry("2026-09-20T10:00:00.000Z", { model, connectionId: "one-account" }));
  const stats = await repo.getUsageStats("7d");
  expect(Object.values(stats.byAccount).map(({ rawModel, requests }) => ({ rawModel, requests }))).toEqual([{ rawModel: "first", requests: 3 }]);
});
