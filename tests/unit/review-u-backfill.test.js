import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir;
let previousDataDir;
let db;
let usageRepo;
let backfill;

beforeEach(async () => {
  previousDataDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-u-backfill-"));
  process.env.DATA_DIR = dir;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  vi.resetModules();
  await import("@/lib/db/index.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  usageRepo = await import("@/lib/db/repos/usageRepo.js");
  backfill = (await import("@/lib/db/migrations/033-usage-history-api-key-id-backfill.js")).default;
  db.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)",
    ["backfill-key-id", "sk-backfill-current", "backfill fixture", "2026-11-23T00:00:00.000Z"]);
});

afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

function insertUsage(apiKey, offset, apiKeyId = null) {
  db.run(`INSERT INTO usageHistory(timestamp, provider, model, apiKey, apiKeyId, promptTokens,
    completionTokens, cost, status, tokens, meta) VALUES(?, 'fixture', 'model', ?, ?, 3, 2, 0.25, 'ok', ?, '{}')`,
  [`2026-11-23T00:${String(offset % 60).padStart(2, "0")}:00.000Z`, apiKey, apiKeyId, JSON.stringify({ prompt_tokens: 3, completion_tokens: 2 })]);
}

async function totals() {
  return usageRepo.getApiKeyWindowUsageTotals("sk-backfill-current", "2026-11-23T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "backfill-key-id");
}

describe("usage API key id backfill migration", () => {
  it("fills legacy rows in batches, preserves unknown keys and leaves totals unchanged on rerun", async () => {
    for (let i = 0; i < 505; i += 1) insertUsage("sk-backfill-current", i);
    insertUsage("sk-no-longer-known", 10);
    insertUsage("sk-rotated-before-history-existed", 11);
    insertUsage("old-value", 12, "already-attributed-id");

    const beforeCounts = db.get("SELECT COUNT(*) AS count FROM usageHistory").count;
    const beforeTotals = await totals();
    backfill.up(db);
    expect(db.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(beforeCounts);
    expect(db.get("SELECT COUNT(*) AS count FROM usageHistory WHERE apiKeyId = 'backfill-key-id'").count).toBe(505);
    expect(db.get("SELECT apiKey, apiKeyId FROM usageHistory WHERE apiKey = 'sk-no-longer-known'")).toEqual({ apiKey: "sk-no-longer-known", apiKeyId: null });
    expect(db.get("SELECT apiKey, apiKeyId FROM usageHistory WHERE apiKey = 'sk-rotated-before-history-existed'")).toEqual({ apiKey: "sk-rotated-before-history-existed", apiKeyId: null });
    expect(db.get("SELECT apiKey, apiKeyId FROM usageHistory WHERE apiKeyId = 'already-attributed-id'")).toEqual({ apiKey: "old-value", apiKeyId: "already-attributed-id" });
    expect(await totals()).toEqual(beforeTotals);
    backfill.up(db);
    expect(await totals()).toEqual(beforeTotals);
  });
});
