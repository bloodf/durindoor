// Tests for parseApiKeyPolicy + rowToKey.policy/expiresAt in src/lib/db/repos/apiKeysRepo.js
import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory SQLite-like adapter keyed by apiKey.key. The repo calls
// db.get, db.all, db.run, db.transaction. We support the simple CRUD needed
// for these tests plus policy + expiresAt assertions.
const store = {
  reset() { this.table = null; },
  exec(sql) {
    const m = sql.match(/CREATE TABLE\s+apiKeys\s*\(([^)]+)\)/i);
    if (m) {
      this.table = { cols: m[1].split(",").map((c) => c.trim().split(/\s+/)[0]) };
    }
  },
  run(sql, params = []) {
    const m = sql.match(/INSERT INTO apiKeys\s*\(([^)]+)\)\s*VALUES\(([^)]+)\)/i);
    if (m) {
      const cols = m[1].split(",").map((c) => c.trim());
      const row = {};
      cols.forEach((c, i) => { row[c] = params[i]; });
      this.table[params[1]] = row;
    }
  },
  get(sql, params = []) {
    if (sql.includes("FROM apiKeys") && sql.includes("WHERE key = ?")) {
      return this.table?.[params[0]] || null;
    }
    return null;
  },
  all(sql) {
    if (sql.includes("FROM apiKeys")) {
      return Object.values(this.table || {});
    }
    return [];
  },
  transaction(fn) { fn(); },
};
const adapter = { exec: (s, p) => store.exec(s, p), run: (s, p) => store.run(s, p), get: (s, p) => store.get(s, p), all: (s, p) => store.all(s, p) };

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: () => adapter,
  db: store,
}));

const apiKeysRepo = await import("../../src/lib/db/repos/apiKeysRepo.js");

describe("apiKeysRepo policy + expiresAt parsing", () => {
  beforeEach(() => {
    store.reset();
  });

  function setupSchema() {
    store.exec(`CREATE TABLE apiKeys (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      name TEXT,
      machineId TEXT,
      isActive INTEGER DEFAULT 1,
      allowedCombos TEXT,
      dailyLimitTokens INTEGER,
      policy TEXT,
      expiresAt TEXT,
      createdAt TEXT
    )`);
  }

  it("returns null policy and null expiresAt when neither column is populated", async () => {
    setupSchema();
    store.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["k1", "sk-1", "name1", "machine-1", 1, "[]", null, null, null, "2026-01-01"],
    );
    const row = await apiKeysRepo.getApiKeyByKey("sk-1");
    expect(row).not.toBeNull();
    expect(row.policy).toBeNull();
    expect(row.expiresAt).toBeNull();
    expect(row.dailyLimitTokens).toBeNull();
  });

  it("parses a JSON object policy column into rowToKey.policy", async () => {
    setupSchema();
    const policy = { allowedModels: ["gpt-4o"], maxTokens: 1000, maxCostUsd: 5 };
    store.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["k1", "sk-1", "name1", "machine-1", 1, "[]", null, JSON.stringify(policy), null, "2026-01-01"],
    );
    const row = await apiKeysRepo.getApiKeyByKey("sk-1");
    expect(row).not.toBeNull();
    expect(row.policy).toEqual(policy);
  });

  it("parses an expiresAt column and exposes it on the row", async () => {
    setupSchema();
    store.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["k1", "sk-1", "name1", "machine-1", 1, "[]", null, null, "2030-01-01T00:00:00.000Z", "2026-01-01"],
    );
    const row = await apiKeysRepo.getApiKeyByKey("sk-1");
    expect(row.expiresAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("returns the parsed policy object as a plain object (not a JSON string)", async () => {
    setupSchema();
    store.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["k2", "sk-2", "name2", "machine-2", 1, "[]", null, JSON.stringify({ allowedModels: ["claude-3.5-sonnet"] }), null, "2026-01-01"],
    );
    const row = await apiKeysRepo.getApiKeyByKey("sk-2");
    expect(typeof row.policy).toBe("object");
    expect(row.policy.allowedModels).toEqual(["claude-3.5-sonnet"]);
  });
});
