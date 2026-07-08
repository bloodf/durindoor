import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { getAdapter } from "@/lib/db/driver.js";
import { getApiKeyUsageTotals, getAllApiKeyUsageTotals, incrementApiKeyUsageSync } from "@/lib/db/repos/apiKeyUsageTotalsRepo.js";
import { recordApiKeyUsage } from "@/sse/services/apiKeyPolicy.js";

const tmpDir = mkdtempSync(join(tmpdir(), "api-key-usage-"));
const tmpFile = join(tmpDir, "test.db");
const db = new Database(tmpFile);

// Create only the apiKeys table; deliberately omit apiKeyUsageTotals.
db.exec(`
  CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT NOT NULL, isActive INTEGER, dailyLimitTokens INTEGER);
  INSERT INTO apiKeys(id, key, isActive, dailyLimitTokens) VALUES('key-1', 'secret-key', 1, 1000);
`);

const adapter = {
  driver: "better-sqlite3",
  get(sql, params = []) { return db.prepare(sql).get(params); },
  all(sql, params = []) { return db.prepare(sql).all(params); },
  run(sql, params = []) { return db.prepare(sql).run(params); },
  exec(sql) { return db.exec(sql); },
  close() { db.close(); },
};

global._dbAdapter = global._dbAdapter || { instance: null, initPromise: null, logged: false };
const originalInstance = global._dbAdapter.instance;

beforeAll(() => {
  global._dbAdapter.instance = adapter;
});

afterAll(() => {
  global._dbAdapter.instance = originalInstance;
  adapter.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("apiKeyUsageTotals missing table guard", () => {
  it("getApiKeyUsageTotals returns safe default when table is missing", async () => {
    const result = await getApiKeyUsageTotals("key-1");
    expect(result).toEqual({ totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null });
  });

  it("getAllApiKeyUsageTotals returns empty array when table is missing", async () => {
    const result = await getAllApiKeyUsageTotals();
    expect(result).toEqual([]);
  });

  it("incrementApiKeyUsageSync returns silently when table is missing", () => {
    expect(() => incrementApiKeyUsageSync(adapter, "key-1", { tokens: 10, cost: 0.001 })).not.toThrow();
  });

  it("recordApiKeyUsage returns silently when table is missing", async () => {
    await expect(recordApiKeyUsage("secret-key", { tokens: 10, cost: 0.001 })).resolves.toBeUndefined();
  });

  it("getAdapter returns the test adapter", async () => {
    const adapterFromDriver = await getAdapter();
    expect(adapterFromDriver).toBe(adapter);
  });
});
