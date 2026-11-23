import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secret = "sk-stop-raw-fixture";
let dir;
let oldDataDir;
let db;
let database;

beforeEach(async () => {
  oldDataDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-stop-raw-"));
  fs.writeFileSync(path.join(dir, "master-key"), randomBytes(32), { mode: 0o600 });
  process.env.DATA_DIR = dir;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  vi.resetModules();
  database = await import("@/lib/db/index.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  db.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)", ["stop-raw-id", secret, "fixture", "2026-11-23T00:00:00.000Z"]);
});

afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  if (oldDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = oldDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("usage storage does not retain raw API keys", () => {
  it("writes only the stable key id and keeps caps, window totals and summaries", async () => {
    await database.saveRequestUsage({
      timestamp: "2026-11-23T00:00:00.000Z", provider: "fixture", model: "model", apiKey: secret,
      tokens: { prompt_tokens: 4, completion_tokens: 3 }, cost: 0.25, status: "ok", usageEventId: "stop-raw-event",
    });

    expect(db.get("SELECT apiKey, apiKeyId FROM usageHistory WHERE usageEventId = ?", ["stop-raw-event"]))
      .toEqual({ apiKey: null, apiKeyId: "stop-raw-id" });
    expect(JSON.stringify(db.all("SELECT data FROM usageDaily"))).not.toContain(secret);
    expect(JSON.stringify(db.all("SELECT * FROM usageLastSeen"))).not.toContain(secret);
    const totals = await (await import("@/lib/db/repos/usageRepo.js")).getApiKeyWindowUsageTotals(secret, "2026-11-23T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "stop-raw-id");
    expect(totals.day).toMatchObject({ inputTokens: 4, requests: 1, cost: 0.25 });
    expect(totals.month).toMatchObject({ inputTokens: 4, requests: 1, cost: 0.25 });
    const summary = await (await import("@/lib/db/repos/usageRepo.js")).getUsageStats("30d");
    expect(Object.values(summary.byApiKey).reduce((sum, row) => sum + row.requests, 0)).toBe(1);
  });

  it("backfills ids, HMACs unmatched legacy keys, and clears raw values in every usage table", async () => {
    const unknown = "sk-deleted-legacy-fixture";
    db.run("INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, 'fixture', 'model', ?, 2, 1, 0.5, 'ok', '{}', '{}')", ["2026-11-22T00:00:00.000Z", secret]);
    db.run("INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, 'fixture', 'model', ?, 2, 1, 0.5, 'ok', '{}', '{}')", ["2026-11-22T00:00:00.000Z", unknown]);
    const migration = (await import("@/lib/db/migrations/036-stop-raw-usage-api-keys.js")).default;
    migration.up(db);
    const hmac = (await import("@/lib/db/helpers/apiKeyAttribution.js")).usageKeyIdentity(null, unknown);
    expect(db.get("SELECT apiKey, apiKeyId FROM usageHistory WHERE timestamp = ?", ["2026-11-22T00:00:00.000Z"]))
      .toEqual({ apiKey: null, apiKeyId: "stop-raw-id" });
    expect(db.get("SELECT apiKey FROM usageHistory WHERE apiKey = ?", [hmac])).toEqual({ apiKey: hmac });
    expect(JSON.stringify(db.all("SELECT apiKey FROM usageHistory"))).not.toContain(secret);
    migration.up(db);
    expect(db.get("SELECT apiKey FROM usageHistory WHERE apiKey = ?", [hmac])).toEqual({ apiKey: hmac });
  });
});
