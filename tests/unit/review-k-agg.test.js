import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const now = "2026-09-20T12:00:00.000Z";
const initial = "2026-09-19T13:00:00.000Z";
const rotated = "2026-09-20T11:00:00.000Z";
let dir, repo, db;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-k-agg-"));
  vi.stubEnv("DATA_DIR", dir);
  delete global._dbAdapter;
  vi.resetModules();
  repo = await import("@/lib/db/repos/usageRepo.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
});

afterEach(async () => {
  vi.useRealTimers();
  global._dbAdapter?.instance?.close();
  delete global._dbAdapter;
  await disposeLoadedRequestDetailsRepo();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

function insertKey(id, secret, name) {
  db.run("INSERT INTO apiKeys(id, key, name, createdAt) VALUES (?, ?, ?, ?)", [id, secret, name, initial]);
}

function writeUsage(timestamp, apiKey, apiKeyId) {
  return repo.saveRequestUsage({
    timestamp, apiKey, apiKeyId, provider: "fixture", model: "model", cost: 0,
    tokens: { prompt_tokens: 2, completion_tokens: 3 }, strict: true,
  });
}

it("preserves single-key totals, legacy association, and the current key label", async () => {
  insertKey("alpha", "fixture-first", "Alpha");
  await writeUsage(initial, "fixture-first", "alpha");
  await writeUsage(rotated, "fixture-first", "alpha");
  db.run("UPDATE usageHistory SET apiKeyId = NULL WHERE timestamp = ?", [rotated]);
  const window = await repo.getApiKeyWindowUsageTotals("fixture-first", initial, initial, "alpha");
  expect(window.day).toMatchObject({ requests: 2, inputTokens: 4, outputTokens: 6 });
  for (const period of ["all", "7d", "24h"]) {
    const stats = await repo.getUsageStats(period);
    expect(stats).toMatchObject({ totalRequests: 2, totalPromptTokens: 4, totalCompletionTokens: 6 });
    expect(Object.values(stats.byApiKey)).toEqual([expect.objectContaining({
      apiKeyKey: "api-key:alpha", keyName: "Alpha", requests: 2, lastUsed: rotated,
    })]);
  }
});

// Issue #2298. Remove the expected failures when the identity migration and readers land.
it.fails("merges usage across rotation while keeping a second key independent", async () => {
  insertKey("alpha", "fixture-first", "Alpha");
  insertKey("beta", "fixture-other", "Beta");
  await writeUsage(initial, "fixture-first", "alpha");
  db.run("UPDATE apiKeys SET key = ?, name = ? WHERE id = ?", ["fixture-rotated", "Renamed Alpha", "alpha"]);
  await writeUsage(rotated, "fixture-rotated", "alpha");
  await writeUsage(rotated, "fixture-other", "beta");

  for (const period of ["all", "7d", "24h"]) {
    const stats = await repo.getUsageStats(period);
    expect(stats).toMatchObject({ totalRequests: 3, totalPromptTokens: 6, totalCompletionTokens: 9 });
    expect(Object.values(stats.byApiKey)).toEqual([
      expect.objectContaining({ apiKeyKey: "api-key:alpha", keyName: "Renamed Alpha", requests: 2, lastUsed: rotated }),
      expect.objectContaining({ apiKeyKey: "api-key:beta", keyName: "Beta", requests: 1, lastUsed: rotated }),
    ]);
  }
});

it.fails("stores the stable identity and maximum timestamp for same-day rotated writes", async () => {
  insertKey("alpha", "fixture-first", "Alpha");
  await writeUsage(rotated, "fixture-first", "alpha");
  db.run("UPDATE apiKeys SET key = ? WHERE id = ?", ["fixture-rotated", "alpha"]);
  await writeUsage("2026-09-20T09:00:00.000Z", "fixture-rotated", "alpha");
  expect(db.all("SELECT apiKey, lastUsed FROM usageLastSeen")).toEqual([{ apiKey: "alpha", lastUsed: rotated }]);
});

it.fails("stores one daily key bucket without retaining either rotated secret", async () => {
  insertKey("alpha", "fixture-first", "Alpha");
  await writeUsage(rotated, "fixture-first", "alpha");
  db.run("UPDATE apiKeys SET key = ? WHERE id = ?", ["fixture-rotated", "alpha"]);
  await writeUsage(rotated, "fixture-rotated", "alpha");
  const { data } = db.get("SELECT data FROM usageDaily");
  expect(data).not.toContain("fixture-first");
  expect(data).not.toContain("fixture-rotated");
  expect(Object.values(JSON.parse(data).byApiKey)).toEqual([expect.objectContaining({ requests: 2 })]);
});
