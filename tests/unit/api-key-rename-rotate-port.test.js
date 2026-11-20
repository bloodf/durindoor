// #1072 / 9router #5545: rotating an API key replaces the credential and
// nothing else.
//
// The row is the account and the secret is only the credential that opens it.
// A rotation therefore swaps the secret in place: the key keeps its id, its
// scopes, its quota and its usage, so a rotated key cannot buy a fresh
// allowance and its history stays attached to it. The retired secret stops
// validating the moment the swap commits and is never written down anywhere.
//
// The fixtures are synthetic. Real API keys, real provider calls and real
// databases are out of scope: every secret, id and usage row here is made up
// for the test.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rotateApiKey: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
  getGroupIdsForApiKey: vi.fn(),
  canManageAccessConfig: vi.fn(),
  getConsistentMachineId: vi.fn(),
  generateApiKeyWithMachine: null,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/dashboardGuard", () => ({
  canManageAccessConfig: mocks.canManageAccessConfig,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/localDb", () => ({
  rotateApiKey: mocks.rotateApiKey,
  getApiKeyUsageTotals: mocks.getApiKeyUsageTotals,
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
  getGroupIdsForApiKey: mocks.getGroupIdsForApiKey,
}));

// The secret generator is replaceable so a test can force a collision or a
// failure inside the rotation. Without a replacement the real generator runs.
vi.mock("@/shared/utils/apiKey", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateApiKeyWithMachine: (...args) => (mocks.generateApiKeyWithMachine
      ? mocks.generateApiKeyWithMachine(...args)
      : actual.generateApiKeyWithMachine(...args)),
  };
});

const { POST: rotateRoute } = await import("../../src/app/api/keys/[id]/rotate/route");

const MACHINE = "fixturemachine";
const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-key-rotate-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  mocks.rotateApiKey.mockReset();
  mocks.getApiKeyUsageTotals.mockReset();
  mocks.getApiKeyProviderConnectionIds.mockReset();
  mocks.getGroupIdsForApiKey.mockReset();
  mocks.canManageAccessConfig.mockReset();
  mocks.getConsistentMachineId.mockReset();
  mocks.generateApiKeyWithMachine = null;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** The repository and the database behind it, loaded against a private directory. */
async function loadRepo() {
  const repo = await import("@/lib/db/repos/apiKeysRepo.js");
  const database = await import("@/lib/db/index.js");
  const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  return { repo, database, adapter };
}

/** A stored key with a scope, a quota and a policy. */
async function createKey(database, overrides = {}) {
  return await database.createApiKey(
    overrides.name || "Fixture key",
    MACHINE,
    overrides.allowedCombos || ["combo-a"],
    overrides.dailyLimitTokens ?? 1000,
    overrides.expiresAt ?? null,
    { policy: overrides.policy || null, isAdmin: overrides.isAdmin === true }
  );
}

/** Every place a table still holds the given literal. */
function secretOccurrences(adapter, secret) {
  const tables = adapter
    .all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .map((row) => row.name);
  const hits = [];
  for (const table of tables) {
    const columns = adapter
      .all(`PRAGMA table_info("${table}")`)
      .filter((column) => /TEXT/i.test(column.type || ""))
      .map((column) => column.name);
    for (const column of columns) {
      const rows = adapter.all(
        `SELECT COUNT(*) AS count FROM "${table}" WHERE CAST("${column}" AS TEXT) = ?`,
        [secret]
      );
      if (rows[0].count > 0) hits.push({ table, column, count: rows[0].count });
    }
  }
  return hits;
}

describe("POST /api/keys/[id]/rotate", () => {
  const request = () => new Request("https://durindoor.local/api/keys/key-id/rotate", { method: "POST" });
  const params = { params: Promise.resolve({ id: "key-id" }) };

  beforeEach(() => {
    mocks.canManageAccessConfig.mockResolvedValue(true);
    mocks.getConsistentMachineId.mockResolvedValue(MACHINE);
    mocks.getApiKeyUsageTotals.mockResolvedValue({ totalTokens: 10, totalCost: 1, totalRequests: 2 });
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue(["connection-a"]);
    mocks.getGroupIdsForApiKey.mockResolvedValue(["group-a"]);
  });

  it("denies an unauthenticated caller and rotates nothing", async () => {
    mocks.canManageAccessConfig.mockResolvedValue(false);

    const response = await rotateRoute(request(), params);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Rotating an API key requires an operator session" });
    expect(mocks.rotateApiKey).not.toHaveBeenCalled();
  });

  it("denies a caller without the key-management permission", async () => {
    // A key without the admin scope reaches the route as an ordinary API-key
    // caller, which the management gate refuses.
    mocks.canManageAccessConfig.mockResolvedValue(false);

    const response = await rotateRoute(request(), params);

    expect(response.status).toBe(403);
    expect(mocks.rotateApiKey).not.toHaveBeenCalled();
  });

  it("returns the new secret once and keeps the key's identity", async () => {
    mocks.rotateApiKey.mockResolvedValue({
      status: "rotated",
      key: {
        id: "key-id",
        key: "sk-fixturemachine-newkey-1a2b3c4d",
        name: "Production",
        machineId: MACHINE,
        isActive: true,
        allowedCombos: ["combo-a"],
        dailyLimitTokens: 1000,
        policy: { allowedModels: ["openai/gpt-test"] },
        expiresAt: "2999-01-01T00:00:00.000Z",
        isAdmin: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const response = await rotateRoute(request(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.key).toBe("sk-fixturemachine-newkey-1a2b3c4d");
    expect(body.id).toBe("key-id");
    expect(body.isAdmin).toBe(true);
    expect(body.dailyLimitTokens).toBe(1000);
    expect(body.allowedCombos).toEqual(["combo-a"]);
    expect(body.providerConnectionIds).toEqual(["connection-a"]);
    expect(body.groupIds).toEqual(["group-a"]);
    expect(body.usage).toMatchObject({ totalRequests: 2 });
    expect(mocks.getConsistentMachineId).toHaveBeenCalled();
  });

  it("404s for a key that does not exist", async () => {
    mocks.rotateApiKey.mockResolvedValue({ status: "not_found" });

    const response = await rotateRoute(request(), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Key not found" });
  });

  it("reports a competing rotation as a conflict and returns no secret", async () => {
    mocks.rotateApiKey.mockResolvedValue({ status: "conflict" });

    const response = await rotateRoute(request(), params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/rotated by another request/);
    expect(body.key).toBeUndefined();
  });

  it("fails closed when the rotation throws, without leaking a secret", async () => {
    mocks.rotateApiKey.mockRejectedValue(new Error("database is locked"));

    const response = await rotateRoute(request(), params);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to rotate key" });
    expect(JSON.stringify(body)).not.toContain("sk-");
  });
});

describe("rotateApiKey", () => {
  it("replaces the secret and keeps the key's identity, scope and quota", async () => {
    const { repo, database } = await loadRepo();
    const key = await createKey(database, {
      name: "Production",
      allowedCombos: ["combo-a"],
      dailyLimitTokens: 1000,
      policy: { allowedModels: ["openai/gpt-test"] },
      isAdmin: true,
    });

    const outcome = await repo.rotateApiKey(key.id, MACHINE);

    expect(outcome.status).toBe("rotated");
    const rotated = outcome.key;
    expect(rotated.key).not.toBe(key.key);
    expect(rotated.id).toBe(key.id);
    expect(rotated.name).toBe("Production");
    expect(rotated.isActive).toBe(true);
    expect(rotated.isAdmin).toBe(true);
    expect(rotated.allowedCombos).toEqual(["combo-a"]);
    expect(rotated.dailyLimitTokens).toBe(1000);
    expect(rotated.policy).toEqual({ allowedModels: ["openai/gpt-test"] });
    expect(rotated.createdAt).toBe(key.createdAt);
    expect(rotated.machineId).toBe(MACHINE);
  });

  it("invalidates the previous credential for authentication immediately", async () => {
    const { repo, database } = await loadRepo();
    const key = await createKey(database);

    const outcome = await repo.rotateApiKey(key.id, MACHINE);

    expect(await database.validateApiKey(key.key)).toBe(false);
    expect(await database.validateApiKey(outcome.key.key)).toBe(true);
    // The row the caller holds on to is the same account, not a second one.
    expect((await database.getApiKeyByKey(outcome.key.key)).id).toBe(key.id);
  });

  it("keeps a paused key paused", async () => {
    const { repo, database } = await loadRepo();
    const key = await createKey(database);
    await database.updateApiKey(key.id, { isActive: false });

    const outcome = await repo.rotateApiKey(key.id, MACHINE);

    expect(outcome.key.isActive).toBe(false);
    expect(await database.validateApiKey(outcome.key.key)).toBe(false);
  });

  it("keeps the key's usage, daily limit and windows across the rotation", async () => {
    const { repo, database, adapter } = await loadRepo();
    const key = await createKey(database, { dailyLimitTokens: 100 });

    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: key.key, apiKeyId: key.id,
      usageEventId: "before-rotate", tokens: { prompt_tokens: 40, completion_tokens: 60 }, cost: 0.5, costStatus: "known", costSource: "provider",
    });

    const outcome = await repo.rotateApiKey(key.id, MACHINE);
    const rotated = outcome.key;

    // A request admitted before the rotation settles after it. It carries the
    // key's stable id, so it lands on the same account.
    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: key.key, apiKeyId: key.id,
      usageEventId: "after-rotate", tokens: { prompt_tokens: 1, completion_tokens: 1 }, cost: 0.1, costStatus: "known", costSource: "provider",
    });

    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({
      totalRequests: 2, totalTokens: 102, totalCost: 0.6,
    });

    const dayStart = new Date().toISOString().slice(0, 10);
    const windows = await database.getApiKeyWindowUsageTotals(rotated.key, dayStart, dayStart, key.id);
    expect(windows.day).toMatchObject({ requests: 2, inputTokens: 41, outputTokens: 61 });

    // The daily allowance belongs to the key, so the rotation cannot reset it.
    const limit = await database.getApiKeyUsageLimitStatus(rotated.key, new Date(), key.id);
    expect(limit.enforced).toBe(true);
    expect(limit.exceeded).toBe(true);

    // The rows still belong to the key.
    const rows = adapter.all(`SELECT apiKeyId FROM usageHistory ORDER BY id`);
    expect(rows.map((row) => row.apiKeyId)).toEqual([key.id, key.id]);
  });

  it("keeps the in-memory rate window with the key across the rotation", async () => {
    const { repo, database } = await loadRepo();
    const limits = await import("@/lib/apiKeyLimits.js");
    const key = await createKey(database, { policy: { rpmLimit: 1 } });
    const record = await database.getApiKeyByKey(key.key);

    expect(await limits.enforceApiKeyLimits(null, record)).toBeNull();

    const outcome = await repo.rotateApiKey(key.id, MACHINE);
    const rotated = await database.getApiKeyByKey(outcome.key.key);

    // The request window followed the key, not the secret it was counted under.
    expect((await limits.enforceApiKeyLimits(null, rotated)).status).toBe(429);
  });

  it("lets only one of two racing rotations install its secret", async () => {
    const { repo, database, adapter } = await loadRepo();
    const key = await createKey(database);
    const observed = key.key;
    const competing = "sk-fixturemachine-competing-0f0f0f0f";
    const candidate = "sk-fixturemachine-candidate-1e1e1e1e";

    // The key changes underneath the rotation, between its read and its write.
    mocks.generateApiKeyWithMachine = () => {
      adapter.run(`UPDATE apiKeys SET key = ?, machineId = ? WHERE id = ?`, [competing, MACHINE, key.id]);
      return { key: candidate, keyId: "candidat" };
    };

    const outcome = await repo.rotateApiKey(key.id, MACHINE);

    expect(outcome.status).toBe("conflict");
    expect(outcome.key).toBeUndefined();
    // The competing secret is the live one; the losing candidate was never installed.
    expect((await database.getApiKeyById(key.id)).key).toBe(competing);
    expect(await database.validateApiKey(candidate)).toBe(false);
    expect(await database.validateApiKey(competing)).toBe(true);
    expect(await database.validateApiKey(observed)).toBe(false);
  });

  it("rolls back and keeps the old credential when the write fails", async () => {
    const { repo, database } = await loadRepo();
    const key = await createKey(database);
    const other = await createKey(database, { name: "Other key" });

    // The generator hands back a secret another key already stores, so the
    // unique index refuses the write.
    mocks.generateApiKeyWithMachine = () => ({ key: other.key, keyId: "duplicat" });

    await expect(repo.rotateApiKey(key.id, MACHINE)).rejects.toThrow();

    // The failed rotation left nothing behind: the old credential still works
    // and the row is untouched.
    expect(await database.validateApiKey(key.key)).toBe(true);
    const unchanged = await database.getApiKeyById(key.id);
    expect(unchanged.key).toBe(key.key);
    expect(unchanged.name).toBe(key.name);
    expect(await database.validateApiKey(other.key)).toBe(true);
  });

  it("rolls back and keeps the old credential when the generator fails", async () => {
    const { repo, database } = await loadRepo();
    const key = await createKey(database);

    mocks.generateApiKeyWithMachine = () => { throw new Error("no secret available"); };

    await expect(repo.rotateApiKey(key.id, MACHINE)).rejects.toThrow("no secret available");

    expect(await database.validateApiKey(key.key)).toBe(true);
    expect((await database.getApiKeyById(key.id)).key).toBe(key.key);
  });

  it("never records the retired secret anywhere", async () => {
    const { repo, database, adapter } = await loadRepo();
    const key = await createKey(database);

    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: key.key, apiKeyId: key.id,
      usageEventId: "history-1", tokens: { prompt_tokens: 2, completion_tokens: 2 }, cost: 0.1, costStatus: "known", costSource: "provider",
    });
    const before = secretOccurrences(adapter, key.key);

    const outcome = await repo.rotateApiKey(key.id, MACHINE);

    // The rotation adds no copy of the retired secret. The key row no longer
    // holds it, and the history rows that already carried it are the only
    // place it appears: their number did not grow.
    const after = secretOccurrences(adapter, key.key);
    expect(after.filter((hit) => hit.table === "apiKeys")).toEqual([]);
    expect(after.filter((hit) => hit.table !== "apiKeys")).toEqual(before.filter((hit) => hit.table !== "apiKeys"));
    expect(adapter.all(`SELECT key FROM apiKeys`).map((row) => row.key)).toEqual([outcome.key.key]);
    expect(JSON.stringify(outcome)).not.toContain(key.key);
  });

  it("upgrades a legacy secret to the current format", async () => {
    const { repo, database, adapter } = await loadRepo();
    const key = await createKey(database);
    const legacy = "sk-1a2b3c4d";
    adapter.run(`UPDATE apiKeys SET key = ? WHERE id = ?`, [legacy, key.id]);

    const outcome = await repo.rotateApiKey(key.id, MACHINE);

    expect(outcome.status).toBe("rotated");
    expect(outcome.key.key).not.toBe(legacy);
    expect(outcome.key.key).toMatch(/^sk-fixturemachine-[^-]+-[0-9a-f]{8}$/);
    const { parseApiKey } = await import("@/shared/utils/apiKey.js");
    expect(parseApiKey(outcome.key.key)).toMatchObject({ machineId: MACHINE, isNewFormat: true });
    expect(await database.validateApiKey(legacy)).toBe(false);
    expect(await database.validateApiKey(outcome.key.key)).toBe(true);
  });

  it("reports an unknown key instead of creating one", async () => {
    const { repo, database, adapter } = await loadRepo();

    const outcome = await repo.rotateApiKey("missing-id", MACHINE);

    expect(outcome).toEqual({ status: "not_found" });
    expect(adapter.all(`SELECT id FROM apiKeys`)).toEqual([]);
    expect(await database.getApiKeyById("missing-id")).toBeNull();
  });
});
