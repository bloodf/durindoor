// #1072: an API key's usage and its limits belong to the key, not to the
// secret it stores. The stable key id admitted with a request is carried
// through stored usage and in-flight finalization, so a later secret change
// cannot reset a key's budgets, and two keys never share one budget.
//
// The fixtures are synthetic: real API keys, real provider calls and real
// databases are out of scope. A "secret change" is the same row update a
// rotation endpoint would perform, so the accounting contract is exercised
// without adding one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
const CREATED = "2026-01-01T00:00:00.000Z";
let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-stable-limit-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
});

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  try { global._dbAdapter?.instance?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Load the database and the limit checker against a private temp directory. */
async function load() {
  const database = await import("@/lib/db/index.js");
  const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  const limits = await import("@/lib/apiKeyLimits.js");
  return { database, adapter, limits };
}

/** A stored key with a stable id and a policy. */
async function createKey(database, name, secret, policy = null) {
  const created = await database.createApiKey(name, "fixture-machine", [], null, null, { policy });
  if (secret !== created.key) {
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    adapter.run(`UPDATE apiKeys SET key = ? WHERE id = ?`, [secret, created.id]);
  }
  return { ...created, key: secret };
}

/** Replace a key's secret, the way a rotation would. */
function rotateSecret(adapter, id, nextSecret) {
  adapter.run(`UPDATE apiKeys SET key = ? WHERE id = ?`, [nextSecret, id]);
}

/** One usage row. `apiKeyId` null models a row written before stable ids. */
function insertRow(adapter, { apiKey, apiKeyId = null, promptTokens = 0, completionTokens = 0, cost = null, timestamp = CREATED, provider = "openai", status = "ok" }) {
  adapter.run(
    `INSERT INTO usageHistory(timestamp, provider, model, apiKey, apiKeyId, promptTokens, completionTokens, cost, status)
     VALUES(?, ?, 'gpt-test', ?, ?, ?, ?, ?, ?)`,
    [timestamp, provider, apiKey, apiKeyId, promptTokens, completionTokens, cost, status],
  );
}

const dayStart = new Date(CREATED).toISOString();

describe("stable API-key attribution", () => {
  it("counts legacy and new rows of one key in the same window exactly once", async () => {
    const { database, adapter } = await load();
    const key = await createKey(database, "mixed", "sk-mixed-secret");

    // A row written before stable ids existed, and one written after.
    insertRow(adapter, { apiKey: "sk-mixed-secret", promptTokens: 10, completionTokens: 5, cost: 0.25 });
    insertRow(adapter, { apiKey: "sk-mixed-secret", apiKeyId: key.id, promptTokens: 7, completionTokens: 3, cost: 0.5 });

    const totals = await database.getApiKeyWindowUsageTotals("sk-mixed-secret", dayStart, dayStart, key.id);
    expect(totals.day).toEqual({ inputTokens: 17, outputTokens: 8, requests: 2, cost: 0.75, unknownCostRequests: 0 });

    // The new row carries both the id and the secret. It is counted once.
    const withoutId = await database.getApiKeyWindowUsageTotals("sk-mixed-secret", dayStart, dayStart, null);
    expect(withoutId.day.requests).toBe(2);
  });

  it("keeps independent keys apart, including a row whose secret belongs to another key", async () => {
    const { database, adapter } = await load();
    const first = await createKey(database, "first", "sk-first-secret");
    const second = await createKey(database, "second", "sk-second-secret");

    insertRow(adapter, { apiKey: "sk-first-secret", apiKeyId: first.id, promptTokens: 10, cost: 1 });
    insertRow(adapter, { apiKey: "sk-second-secret", apiKeyId: second.id, promptTokens: 20, cost: 2 });
    // A row charged to the second key that still stores the first key's secret.
    insertRow(adapter, { apiKey: "sk-first-secret", apiKeyId: second.id, promptTokens: 30, cost: 3 });

    const firstWindow = await database.getApiKeyWindowUsageTotals("sk-first-secret", dayStart, dayStart, first.id);
    expect(firstWindow.day).toMatchObject({ requests: 1, inputTokens: 10, cost: 1 });

    const secondWindow = await database.getApiKeyWindowUsageTotals("sk-second-secret", dayStart, dayStart, second.id);
    expect(secondWindow.day).toMatchObject({ requests: 2, inputTokens: 50, cost: 5 });

    expect(await database.getApiKeyUsageTotals(first.id)).toMatchObject({ totalRequests: 0 });
    expect(await database.getApiKeyUsageTotals(second.id)).toMatchObject({ totalRequests: 0 });
  });

  it("charges a request admitted before a secret change to the key it was admitted for", async () => {
    const { database, adapter } = await load();
    const key = await createKey(database, "late", "sk-late-secret");

    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: "sk-late-secret", apiKeyId: key.id,
      usageEventId: "late-1", tokens: { prompt_tokens: 4, completion_tokens: 6 }, cost: 0.5, costStatus: "known", costSource: "provider",
    });
    rotateSecret(adapter, key.id, "sk-late-rotated");

    const rotated = await database.getApiKeyByKey("sk-late-rotated");
    expect(rotated.id).toBe(key.id);

    const totals = await database.getApiKeyWindowUsageTotals(rotated.key, dayStart, dayStart, rotated.id);
    expect(totals.day).toMatchObject({ requests: 1, inputTokens: 4, outputTokens: 6, cost: 0.5 });
    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({
      totalRequests: 1, totalTokens: 10, totalCost: 0.5,
    });
  });

  it("settles an in-flight job against the key that accepted it", async () => {
    const { database, adapter } = await load();
    const key = await createKey(database, "inflight", "sk-inflight-secret");

    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: "sk-inflight-secret", apiKeyId: key.id,
      usageEventId: "job-1", status: "accepted", tokens: {}, cost: null, costStatus: "unknown", costSource: "accepted-job",
      meta: { jobState: "accepted" },
    });
    // The secret changes while the job is still running.
    rotateSecret(adapter, key.id, "sk-inflight-rotated");

    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: "sk-inflight-secret", apiKeyId: key.id,
      usageEventId: "job-1", tokens: { prompt_tokens: 3, completion_tokens: 4 }, cost: 0.25, costStatus: "known", costSource: "provider",
    });

    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({
      totalRequests: 1, totalTokens: 7, totalCost: 0.25,
    });
    const row = adapter.get(`SELECT apiKeyId, status FROM usageHistory WHERE usageEventId = 'job-1'`);
    expect(row.apiKeyId).toBe(key.id);
    expect(row.status).toBe("ok");
  });

  it("keeps a key's monthly budget after its secret changes", async () => {
    const { database, adapter, limits } = await load();
    const key = await createKey(database, "budget", "sk-budget-secret", { monthlyBudget: 1 });

    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: "sk-budget-secret", apiKeyId: key.id,
      usageEventId: "budget-1", tokens: { prompt_tokens: 10, completion_tokens: 10 }, cost: 0.75, costStatus: "known", costSource: "provider",
    });
    rotateSecret(adapter, key.id, "sk-budget-rotated");

    const rotated = await database.getApiKeyByKey("sk-budget-rotated");
    expect(await limits.checkApiKeyLimits(rotated)).toBeNull();

    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: "sk-budget-rotated", apiKeyId: rotated.id,
      usageEventId: "budget-2", tokens: { prompt_tokens: 1, completion_tokens: 1 }, cost: 0.5, costStatus: "known", costSource: "provider",
    });
    expect((await limits.checkApiKeyLimits(rotated)).message).toMatch(/monthly budget limit reached/);
  });

  it("keeps the in-memory request and token windows with the key across a secret change", async () => {
    const { database, adapter, limits } = await load();
    const key = await createKey(database, "windows", "sk-window-secret", { rpmLimit: 2, tpmLimit: 100 });
    const record = await database.getApiKeyByKey("sk-window-secret");

    expect(await limits.enforceApiKeyLimits(null, record)).toBeNull();
    expect(await limits.enforceApiKeyLimits(null, record)).toBeNull();

    rotateSecret(adapter, key.id, "sk-window-rotated");
    const rotated = await database.getApiKeyByKey("sk-window-rotated");

    // The request window follows the key, not the secret it was counted under.
    expect((await limits.enforceApiKeyLimits(null, rotated)).status).toBe(429);

    // The token window follows the key too.
    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: "sk-window-rotated", apiKeyId: rotated.id,
      usageEventId: "window-tokens", tokens: { prompt_tokens: 70, completion_tokens: 40 },
    });
    expect((await limits.checkApiKeyLimits(rotated)).message).toMatch(/tokens\/minute/);
  });

  it("keeps two keys with the same limit independent of each other", async () => {
    const { database, limits } = await load();
    const first = await createKey(database, "rpm-first", "sk-rpm-first", { rpmLimit: 1 });
    const second = await createKey(database, "rpm-second", "sk-rpm-second", { rpmLimit: 1 });
    const firstRecord = await database.getApiKeyByKey(first.key);
    const secondRecord = await database.getApiKeyByKey(second.key);

    expect(await limits.enforceApiKeyLimits(null, firstRecord)).toBeNull();
    expect(await limits.enforceApiKeyLimits(null, secondRecord)).toBeNull();
    expect((await limits.enforceApiKeyLimits(null, firstRecord)).status).toBe(429);
    expect((await limits.enforceApiKeyLimits(null, secondRecord)).status).toBe(429);
  });

  it("counts every concurrent request of one key exactly once", async () => {
    const { database } = await load();
    const key = await createKey(database, "concurrent", "sk-concurrent-secret");

    await Promise.all(Array.from({ length: 12 }, (_, index) => database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: "sk-concurrent-secret", apiKeyId: key.id,
      usageEventId: `concurrent-${index}`, tokens: { prompt_tokens: 2, completion_tokens: 3 }, cost: 0.25, costStatus: "known", costSource: "provider",
    })));

    const totals = await database.getApiKeyUsageTotals(key.id);
    expect(totals.totalRequests).toBe(12);
    expect(totals.totalTokens).toBe(60);
    expect(totals.totalCost).toBeCloseTo(3);

    const window = await database.getApiKeyWindowUsageTotals("sk-concurrent-secret", dayStart, dayStart, key.id);
    expect(window.day).toMatchObject({ requests: 12, inputTokens: 24, outputTokens: 36 });
  });

  it("leaves anonymous and deleted keys unattributed", async () => {
    const { database, adapter } = await load();
    const key = await createKey(database, "kept", "sk-kept-secret");
    const dropped = await createKey(database, "dropped", "sk-dropped-secret");

    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", tokens: { prompt_tokens: 5, completion_tokens: 5 },
      usageEventId: "anonymous-1", cost: 1, costStatus: "known", costSource: "provider",
    });
    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: "sk-dropped-secret", apiKeyId: dropped.id,
      usageEventId: "dropped-1", tokens: { prompt_tokens: 5, completion_tokens: 5 }, cost: 1, costStatus: "known", costSource: "provider",
    });

    await database.deleteApiKey(dropped.id);

    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({ totalRequests: 0, totalTokens: 0 });
    const kept = await database.getApiKeyWindowUsageTotals("sk-kept-secret", dayStart, dayStart, key.id);
    expect(kept.day).toMatchObject({ requests: 0, cost: 0 });
    const rows = adapter.all(`SELECT apiKeyId FROM usageHistory ORDER BY id`);
    expect(rows.map((row) => row.apiKeyId)).toEqual([null, dropped.id]);
  });

  it("never exposes the stable key id in a usage response", async () => {
    const { database } = await load();
    const key = await createKey(database, "public", "sk-public-secret");

    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: "sk-public-secret", apiKeyId: key.id,
      usageEventId: "public-1", tokens: { prompt_tokens: 2, completion_tokens: 3 }, cost: 0.5, costStatus: "known", costSource: "provider",
    });

    const history = await database.getUsageHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).not.toHaveProperty("apiKeyId");
    expect(JSON.stringify(history)).not.toContain(key.id);
  });
});
