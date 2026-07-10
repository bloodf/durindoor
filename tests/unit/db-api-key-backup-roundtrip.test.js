// Backup/import must preserve enforcement metadata and durable usage counters
// without rewriting the API-key secret used by existing clients.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let originalDataDir;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-api-key-backup-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("API-key database backup", () => {
  it("round-trips policy, expiry, totals, and the exact stored secret", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const secret = "sk-deadbeef";
    db.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt)
       VALUES(?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        "key-1",
        secret,
        "Backup key",
        "machine-original",
        JSON.stringify(["combo-a", "combo-b"]),
        1200,
        JSON.stringify({ allowedModels: ["openai/gpt-test"] }),
        "2030-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ],
    );
    db.run(
      `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      ["key-1", 44, 1.25, 3, "2026-01-02T00:00:00.000Z"],
    );

    const snapshot = await database.exportDb();
    expect(snapshot.apiKeys[0]).toMatchObject({
      key: secret,
      name: "Backup key",
      machineId: "machine-original",
      isActive: false,
      allowedCombos: ["combo-a", "combo-b"],
      dailyLimitTokens: 1200,
      policy: { allowedModels: ["openai/gpt-test"] },
      expiresAt: "2030-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(snapshot.apiKeyUsageTotals[0]).toMatchObject({ totalTokens: 44, totalCost: 1.25, totalRequests: 3 });

    db.run(`UPDATE apiKeys SET key = 'sk-feedface', name = 'changed', machineId = 'changed', isActive = 1,
      allowedCombos = '[]', dailyLimitTokens = NULL, policy = NULL, expiresAt = NULL,
      createdAt = '2999-01-01T00:00:00.000Z' WHERE id = 'key-1'`);
    db.run(`DELETE FROM apiKeyUsageTotals`);
    await database.importDb(snapshot);

    expect(db.get(`SELECT key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt FROM apiKeys WHERE id = 'key-1'`)).toEqual({
      key: secret,
      name: "Backup key",
      machineId: "machine-original",
      isActive: 0,
      allowedCombos: JSON.stringify(["combo-a", "combo-b"]),
      dailyLimitTokens: 1200,
      policy: JSON.stringify({ allowedModels: ["openai/gpt-test"] }),
      expiresAt: "2030-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(db.get(`SELECT totalTokens, totalCost, totalRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'key-1'`)).toEqual({
      totalTokens: 44,
      totalCost: 1.25,
      totalRequests: 3,
    });
  });

  it("backfills totals when importing a pre-totals backup", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const secret = "sk-deadbeef";
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, 'openai', 'gpt-test', ?, 8, 5, 0.75, 'ok', '{}', '{}')`,
      ["2026-01-02T00:00:00.000Z", secret],
    );

    await database.importDb({
      settings: {},
      apiKeys: [{
        id: "key-legacy",
        key: secret,
        name: "Legacy backup key",
        isActive: true,
        allowedCombos: [],
        policy: { maxTokens: 100 },
      }],
    });

    expect(await database.getApiKeyUsageTotals("key-legacy")).toMatchObject({
      totalTokens: 13,
      totalCost: 0.75,
      totalRequests: 1,
    });
    expect(db.get(`SELECT key FROM apiKeys WHERE id = 'key-legacy'`).key).toBe(secret);
  });

  it("rounds fractional non-chat estimates so its own export remains importable", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)`,
      ["fractional", "sk-deadbeef", "Fractional estimate", "2026-01-01T00:00:00.000Z"],
    );

    database.incrementApiKeyUsageSync(db, "fractional", { tokens: 1.75, cost: 0.01 });
    const snapshot = await database.exportDb();
    expect(snapshot.apiKeyUsageTotals[0]).toMatchObject({ totalTokens: 2, totalCost: 0.01, totalRequests: 1 });
    await expect(database.importDb(snapshot)).resolves.toBeDefined();
    expect(await database.getApiKeyUsageTotals("fractional")).toMatchObject({ totalTokens: 2, totalCost: 0.01, totalRequests: 1 });
  });

  it("rejects duplicate secrets and malformed policies without changing the database", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)`,
      ["existing", "sk-cafebabe", "Existing", "2026-01-01T00:00:00.000Z"],
    );

    const duplicateSecret = "sk-deadbeef";
    const duplicateError = await database.importDb({
      apiKeys: [
        { id: "one", key: duplicateSecret, policy: { allowedModels: ["openai/gpt-4o"] } },
        { id: "two", key: duplicateSecret, policy: { maxTokens: 100 } },
      ],
    }).catch((error) => error);
    expect(duplicateError).toBeInstanceOf(Error);
    expect(duplicateError.message).toContain("Duplicate API key key");
    expect(duplicateError.message).not.toContain(duplicateSecret);
    expect(db.get(`SELECT key FROM apiKeys WHERE id = 'existing'`).key).toBe("sk-cafebabe");

    await expect(database.importDb({
      apiKeys: [{ id: "one", key: "sk-deadbeef", policy: { allowedModels: "openai/gpt-4o" } }],
    })).rejects.toThrow("allowedModels");
    expect(db.get(`SELECT key FROM apiKeys WHERE id = 'existing'`).key).toBe("sk-cafebabe");

    await expect(database.importDb({
      apiKeys: [{ id: "one", key: "sk-deadbeef", expiresAt: "2030-01-01T00:00:00" }],
    })).rejects.toThrow("absolute ISO-8601");
    expect(db.get(`SELECT key FROM apiKeys WHERE id = 'existing'`).key).toBe("sk-cafebabe");
  });

  it("canonicalizes offset expiries, permits expired history, and preserves exact key bytes on import", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    await database.importDb({
      apiKeys: [
        {
          id: "offset",
          key: "sk-machine-key-crc",
          name: "Offset",
          machineId: "machine-a",
          isActive: true,
          allowedCombos: ["combo-a"],
          dailyLimitTokens: 10,
          policy: { maxTokens: 100 },
          expiresAt: "2030-01-01T03:30:00+03:30",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "historical",
          key: "sk-deadbeef",
          name: "Historical",
          expiresAt: "2000-01-01T00:00:00Z",
          createdAt: "1999-01-01T00:00:00.000Z",
        },
      ],
      apiKeyUsageTotals: [
        { apiKeyId: "offset", totalTokens: 9, totalCost: 0.25, totalRequests: 2, updatedAt: "2026-01-02T00:00:00.000Z" },
        { apiKeyId: "historical", totalTokens: 0, totalCost: 0, totalRequests: 0 },
      ],
    });

    expect(db.get(`SELECT key, expiresAt FROM apiKeys WHERE id = 'offset'`)).toEqual({
      key: "sk-machine-key-crc",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(db.get(`SELECT key, expiresAt FROM apiKeys WHERE id = 'historical'`)).toEqual({
      key: "sk-deadbeef",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    expect(await database.getApiKeyUsageTotals("offset")).toMatchObject({
      totalTokens: 9,
      totalCost: 0.25,
      totalRequests: 2,
    });
  });

  it("fails closed and refuses export when stored policy JSON is corrupt", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const secret = "sk-deadbeef";
    db.run(
      `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt)
       VALUES(?, ?, ?, 1, '[]', ?, ?)`,
      ["corrupt-policy", secret, "Corrupt policy", "{bad-json", "2026-01-01T00:00:00.000Z"],
    );

    const { enforceApiKeyModelPolicy } = await import("../../src/sse/services/apiKeyPolicy.js");
    const response = await enforceApiKeyModelPolicy(new Request("http://localhost/v1/chat/completions", {
      headers: { authorization: `Bearer ${secret}` },
    }), "openai/gpt-4o");

    expect(response?.status).toBe(403);
    await expect(database.exportDb()).rejects.toThrow("API key corrupt-policy has invalid policy JSON");
    await expect(database.exportDb()).rejects.not.toThrow(secret);
  });

  it("refuses to emit a backup with malformed stored expiry", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const secret = "sk-deadbeef";
    db.run(
      `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, expiresAt, createdAt)
       VALUES(?, ?, ?, 1, '[]', ?, ?)`,
      ["corrupt-expiry", secret, "Corrupt expiry", "local-time-only", "2026-01-01T00:00:00.000Z"],
    );

    const error = await database.exportDb().catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("API key corrupt-expiry has invalid expiresAt storage");
    expect(error.message).not.toContain(secret);
  });
});
