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

it("merges usage across rotation while keeping a second key independent", async () => {
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

it("stores the stable identity and maximum timestamp for same-day rotated writes", async () => {
  insertKey("alpha", "fixture-first", "Alpha");
  await writeUsage(rotated, "fixture-first", "alpha");
  db.run("UPDATE apiKeys SET key = ? WHERE id = ?", ["fixture-rotated", "alpha"]);
  await writeUsage("2026-09-20T09:00:00.000Z", "fixture-rotated", "alpha");
  expect(db.all("SELECT apiKey, lastUsed FROM usageLastSeen")).toEqual([{ apiKey: "alpha", lastUsed: rotated }]);
});

it("stores one daily key bucket without retaining either rotated secret", async () => {
  insertKey("alpha", "fixture-first", "Alpha");
  await writeUsage(rotated, "fixture-first", "alpha");
  db.run("UPDATE apiKeys SET key = ? WHERE id = ?", ["fixture-rotated", "alpha"]);
  await writeUsage(rotated, "fixture-rotated", "alpha");
  const { data } = db.get("SELECT data FROM usageDaily");
  expect(data).not.toContain("fixture-first");
  expect(data).not.toContain("fixture-rotated");
  expect(Object.values(JSON.parse(data).byApiKey)).toEqual([expect.objectContaining({ requests: 2 })]);
});

it("migrates legacy last-seen rows across pages and keeps the greatest timestamp on collision", async () => {
  const { default: migration } = await import("@/lib/db/migrations/034-usage-last-seen-key-identity.js");
  insertKey("alpha", "fixture-current", "Alpha");
  db.run("DELETE FROM _meta WHERE key = 'usageLastSeenKeyIdentity'");
  db.run("INSERT INTO usageHistory(timestamp, provider, model, apiKey, apiKeyId) VALUES (?, 'fixture', 'model', 'fixture-old', 'alpha')", [initial]);
  const insert = (model, key, timestamp) => db.run(
    "INSERT INTO usageLastSeen VALUES ('2026-09-19', 'fixture', ?, '', ?, '', ?)",
    [model, key, timestamp]
  );
  insert("model", "fixture-old", initial);
  const latest = "2026-09-19T17:00:00.000Z";
  insert("model", "fixture-current", latest);
  for (let i = 0; i < 101; i++) insert(`extra-${i}`, "fixture-unknown", initial);

  db.transaction(() => migration.up(db));
  const rows = db.all("SELECT model, apiKey, lastUsed FROM usageLastSeen ORDER BY model");
  expect(rows).toHaveLength(102);
  expect(rows.at(-1)).toEqual({ model: "model", apiKey: "alpha", lastUsed: latest });
  const { createHmac } = await import("node:crypto");
  const digest = createHmac("sha256", fs.readFileSync(path.join(dir, "master-key")))
    .update("durindoor:usage-api-key\0").update("fixture-unknown").digest("hex");
  expect(new Set(rows.slice(0, -1).map((row) => row.apiKey))).toEqual(new Set([`hmac:${digest}`]));
  db.transaction(() => migration.up(db));
  expect(db.all("SELECT model, apiKey, lastUsed FROM usageLastSeen ORDER BY model")).toEqual(rows);
});

it("migrates legacy daily buckets without changing the period totals or dropping archived counters", async () => {
  const { default: migration } = await import("@/lib/db/migrations/035-usage-daily-key-identity.js");
  insertKey("alpha", "fixture-current", "Renamed Alpha");
  db.run("INSERT INTO usageHistory(timestamp, provider, model, apiKey, apiKeyId) VALUES (?, 'fixture', 'model', 'fixture-old', 'alpha')", [initial]);
  const bucket = (apiKey, requests, cost) => ({
    apiKey, rawModel: "model", provider: "fixture", requests, promptTokens: requests * 2,
    completionTokens: requests * 3, cost, latencyMs: 100, latencySamples: 1,
  });
  const day = {
    requests: 6, promptTokens: 12, completionTokens: 18, cost: 6,
    byApiKey: {
      "old-hmac|model|fixture": bucket("fixture-old", 1, 1),
      "current-hmac|model|fixture": bucket("fixture-current", 2, 2),
      "unknown-hmac|model|fixture": bucket("fixture-archived", 3, 3),
    },
  };
  db.run("INSERT INTO usageDaily(dateKey, data) VALUES ('2026-09-19', ?)", [JSON.stringify(day)]);

  db.transaction(() => migration.up(db));
  const { data } = db.get("SELECT data FROM usageDaily");
  expect(data).not.toMatch(/fixture-(old|current|archived)/);
  expect(JSON.parse(data)).toMatchObject({
    requests: 6, promptTokens: 12, completionTokens: 18, cost: 6,
    byApiKey: {
      "alpha|model|fixture": { apiKey: "alpha", requests: 3, promptTokens: 6, completionTokens: 9, cost: 3, latencyMs: 200, latencySamples: 2 },
    },
  });
  const stats = await repo.getUsageStats("all", { startDate: "2026-09-19", endDate: "2026-09-19" });
  expect(stats).toMatchObject({ totalRequests: 6, totalCost: 6 });
  expect(stats.byApiKey["api-key:alpha|model|fixture"]).toMatchObject({ keyName: "Renamed Alpha", requests: 3, cost: 3 });
  expect(Object.values(stats.byApiKey)).toContainEqual(expect.objectContaining({ keyName: "Deleted API key 1", requests: 3 }));
  db.transaction(() => migration.up(db));
  expect(db.get("SELECT data FROM usageDaily").data).toBe(data);
});
