import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-privacy-"));
  vi.stubEnv("DATA_DIR", dir);
  delete global._dbAdapter;
  delete global._recentRing;
  vi.resetModules();
});
afterEach(() => {
  global._dbAdapter?.instance?.close();
  delete global._dbAdapter;
  delete global._recentRing;
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("persists non-secret identities and keeps key attribution and totals", async () => {
  const database = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const secret = "hmac-sha256:" + "a".repeat(64);
  db.run("INSERT INTO apiKeys(id, key, name, createdAt) VALUES(?, ?, ?, ?)", ["key-1", secret, "Example", new Date().toISOString()]);
  expect(await database.saveRequestUsage({ provider: "openai", model: "test", apiKey: secret, tokens: { prompt_tokens: 4, completion_tokens: 2 }, cost: 1, strict: true })).toBe(true);
  const row = db.get("SELECT apiKey, apiKeyId FROM usageHistory");
  expect(row.apiKey).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
  expect(row.apiKey).not.toBe(secret);
  expect(row.apiKeyId).toBe("key-1");
  expect(JSON.stringify(db.all("SELECT * FROM usageDaily"))).not.toContain(secret);
  expect(JSON.stringify(db.all("SELECT * FROM usageLastSeen"))).not.toContain(secret);
  expect(await database.getApiKeyUsageTotals("key-1")).toMatchObject({ totalTokens: 6, totalRequests: 1 });
  expect(JSON.stringify(await database.getUsageStats("all"))).toContain("Example");
  expect(db.get("SELECT key FROM apiKeys WHERE id = ?", ["key-1"]).key).toBe(secret);
});

it("migrates legacy history and aggregates without losing totals", async () => {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const { migrateUsageKeyIdentities } = await import("@/lib/db/migrations/033-usage-key-identity.js");
  const db = await getAdapter();
  const secret = "legacy-key-fixture";
  db.run("INSERT INTO apiKeys(id, key, name, createdAt) VALUES(?, ?, ?, ?)", ["old", secret, "Old", new Date().toISOString()]);
  db.run("INSERT INTO usageHistory(timestamp, apiKey) VALUES(?, ?)", ["2026-01-01T00:00:00Z", secret]);
  db.run("INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)", ["2026-01-01", JSON.stringify({ requests: 3, byApiKey: { [`${secret}|test|openai`]: { apiKey: secret, rawModel: "test", provider: "openai", requests: 3 } } })]);
  migrateUsageKeyIdentities(db);
  const row = db.get("SELECT apiKey, apiKeyId FROM usageHistory");
  expect(row.apiKey).not.toBe(secret);
  expect(row.apiKeyId).toBe("old");
  const day = JSON.parse(db.get("SELECT data FROM usageDaily").data);
  expect(day.requests).toBe(3);
  expect(Object.values(day.byApiKey)[0]).toMatchObject({ apiKey: row.apiKey, requests: 3 });
  expect(JSON.stringify(day)).not.toContain(secret);
});

it("sanitizes legacy JSON imports while preserving usage attribution", async () => {
  const secret = "legacy-import-secret";
  fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({ apiKeys: [{ id: "imported", key: secret, createdAt: new Date().toISOString() }] }));
  fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({
    history: [{ timestamp: "2026-01-01T00:00:00Z", apiKey: secret, tokens: { prompt_tokens: 3 }, cost: 1 }],
    dailySummary: { "2026-01-01": { requests: 1, byApiKey: { [`${secret}|model|provider`]: { apiKey: secret, requests: 1 } } } },
  }));
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const history = db.get("SELECT apiKey, apiKeyId FROM usageHistory");
  expect(history.apiKey).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
  expect(history.apiKeyId).toBe("imported");
  expect(db.get("SELECT data FROM usageDaily").data).not.toContain(secret);
  expect(db.get("SELECT totalTokens FROM apiKeyUsageTotals WHERE apiKeyId = ?", ["imported"]).totalTokens).toBe(3);
});
