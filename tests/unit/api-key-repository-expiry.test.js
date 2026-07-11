import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let originalDataDir;
let database;

beforeEach(async () => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-api-key-repo-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  database = await import("@/lib/db/index.js");
  await database.initDb();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("API-key repository expiry", () => {
  it("canonicalizes future creation and rejects invalid, past, or boundary values", async () => {
    const now = Date.parse("2030-01-01T00:00:00.000Z");
    const created = await database.createApiKey(
      "offset",
      "machine-a",
      [],
      null,
      "2030-01-02T03:30:00+03:30",
      now,
    );
    expect(created.expiresAt).toBe("2030-01-02T00:00:00.000Z");
    expect(created.createdAt).toBe("2030-01-01T00:00:00.000Z");

    for (const expiresAt of [
      "",
      "not-a-date",
      "2030-01-02",
      "2030-01-02T00:00:00",
      42,
      false,
      "2029-12-31T23:59:59.999Z",
      "2030-01-01T00:00:00.000Z",
    ]) {
      await expect(database.createApiKey("bad", "machine-a", [], null, expiresAt, now)).rejects.toMatchObject({
        code: "INVALID_API_KEY_EXPIRY",
      });
    }
  });

  it("leaves omitted expiry unchanged, clears only with null, and preserves protected fields", async () => {
    const now = Date.parse("2030-01-01T00:00:00.000Z");
    const key = await database.createApiKey(
      "original",
      "machine-original",
      ["combo-a"],
      700,
      "2030-02-01T00:00:00.000Z",
      now,
    );
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`UPDATE apiKeys SET key = ?, policy = ? WHERE id = ?`, [
      "sk-deadbeef",
      JSON.stringify({ allowedModels: ["openai/gpt-test"] }),
      key.id,
    ]);

    await database.updateApiKey(key.id, {
      name: "renamed",
      allowedCombos: ["combo-b"],
      dailyLimitTokens: 900,
      isActive: false,
      key: "sk-rewritten",
      machineId: "machine-rewritten",
      createdAt: "2999-01-01T00:00:00.000Z",
    }, now);

    const preserved = await database.getApiKeyById(key.id);
    expect(preserved).toMatchObject({
      key: "sk-deadbeef",
      name: "renamed",
      machineId: "machine-original",
      isActive: false,
      allowedCombos: ["combo-b"],
      dailyLimitTokens: 900,
      policy: { allowedModels: ["openai/gpt-test"] },
      expiresAt: "2030-02-01T00:00:00.000Z",
      createdAt: "2030-01-01T00:00:00.000Z",
    });

    await database.updateApiKey(key.id, { expiresAt: null }, now);
    expect((await database.getApiKeyById(key.id)).expiresAt).toBeNull();

    await database.updateApiKey(key.id, { policy: null }, now);
    expect((await database.getApiKeyById(key.id)).policy).toBeNull();
  });

  it("fails closed for inactive, expired, boundary, and malformed stored expiry", async () => {
    const now = Date.parse("2030-01-01T00:00:00.000Z");
    const key = await database.createApiKey("validation", "machine-a", [], null, null, now);
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    expect(await database.validateApiKey(key.key, now)).toBe(true);

    for (const expiresAt of [
      "2029-12-31T23:59:59.999Z",
      "2030-01-01T00:00:00.000Z",
      "malformed",
      "",
    ]) {
      db.run(`UPDATE apiKeys SET isActive = 1, expiresAt = ? WHERE id = ?`, [expiresAt, key.id]);
      expect(await database.validateApiKey(key.key, now)).toBe(false);
    }

    db.run(`UPDATE apiKeys SET isActive = 0, expiresAt = NULL WHERE id = ?`, [key.id]);
    expect(await database.validateApiKey(key.key, now)).toBe(false);
  });

  it("serializes parallel disjoint updates without losing fields", async () => {
    const now = Date.parse("2030-01-01T00:00:00.000Z");
    const key = await database.createApiKey("parallel", "machine-a", [], null, null, now);

    await Promise.all([
      database.updateApiKey(key.id, { name: "parallel-renamed" }, now),
      database.updateApiKey(key.id, { allowedCombos: ["combo-a", "combo-b"] }, now),
      database.updateApiKey(key.id, { dailyLimitTokens: 1_234 }, now),
      database.updateApiKey(key.id, { expiresAt: "2030-03-01T00:00:00.000Z" }, now),
      database.updateApiKey(key.id, { isActive: false }, now),
      database.updateApiKey(key.id, { policyPatch: { maxTokens: 500 } }, now),
      database.updateApiKey(key.id, { policyPatch: { maxCostUsd: 3.5 } }, now),
    ]);

    expect(await database.getApiKeyById(key.id)).toMatchObject({
      key: key.key,
      name: "parallel-renamed",
      machineId: "machine-a",
      isActive: false,
      allowedCombos: ["combo-a", "combo-b"],
      dailyLimitTokens: 1_234,
      expiresAt: "2030-03-01T00:00:00.000Z",
      createdAt: "2030-01-01T00:00:00.000Z",
      policy: { maxTokens: 500, maxCostUsd: 3.5 },
    });
  });

  it("does not resurrect a key in an update/delete race", async () => {
    const now = Date.parse("2030-01-01T00:00:00.000Z");
    const key = await database.createApiKey("race", "machine-a", [], null, null, now);

    await Promise.all([
      database.updateApiKey(key.id, { expiresAt: "2030-02-01T00:00:00.000Z" }, now),
      database.deleteApiKey(key.id),
    ]);

    expect(await database.getApiKeyById(key.id)).toBeNull();
  });
});
