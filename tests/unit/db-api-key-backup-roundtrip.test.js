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
      `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      ["key-1", 44, 1.25, 3, 2, "2026-01-02T00:00:00.000Z"],
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
    expect(snapshot.apiKeyUsageTotals[0]).toMatchObject({ totalTokens: 44, totalCost: 1.25, totalRequests: 3, unknownCostRequests: 2 });

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
    expect(db.get(`SELECT totalTokens, totalCost, totalRequests, unknownCostRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'key-1'`)).toEqual({
      totalTokens: 44,
      totalCost: 1.25,
      totalRequests: 3,
      unknownCostRequests: 2,
    });
  });

  it("starts pre-totals full backups at zero instead of attaching retained local history", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const secret = "sk-deadbeef";
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, 'openai', 'gpt-test', ?, 8, 5, 0.75, 'ok', '{}', '{}')`,
      ["2026-01-02T00:00:00.000Z", secret],
    );
    db.run(
      `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`,
      ["2026-01-02", JSON.stringify({ requests: 1, promptTokens: 8, completionTokens: 5, byProvider: { openai: {} }, byModel: {}, byApiKey: { legacy: { apiKey: secret, requests: 1 } } })],
    );

    await database.importDb({
      settings: {},
      apiKeys: [{
        id: "key-legacy",
        key: secret,
        name: "Legacy backup key",
        isActive: true,
        allowedCombos: [],
        dailyLimitTokens: 10,
        policy: { maxTokens: 100 },
      }],
    });

    expect(await database.getApiKeyUsageTotals("key-legacy")).toMatchObject({
      totalTokens: 0,
      totalCost: 0,
      totalRequests: 0,
      unknownCostRequests: 0,
    });
    expect(db.get(`SELECT key FROM apiKeys WHERE id = 'key-legacy'`).key).toBe(secret);
    await expect(database.getApiKeyUsageLimitStatus(secret, new Date("2026-01-02T12:00:00.000Z"))).resolves.toMatchObject({
      enforced: true,
      exceeded: false,
      usedTokens: 0,
    });
    expect(db.get(`SELECT apiKey FROM usageHistory LIMIT 1`).apiKey).toBeNull();
    expect(JSON.parse(db.get(`SELECT data FROM usageDaily WHERE dateKey = '2026-01-02'`).data).byApiKey).toEqual({});
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

  it("imports older totals without an unknown-cost counter as zero", async () => {
    const database = await import("@/lib/db/index.js");
    await database.importDb({
      apiKeys: [{ id: "legacy-total", key: "sk-deadbeef" }],
      apiKeyUsageTotals: [{ apiKeyId: "legacy-total", totalTokens: 9, totalCost: 0.5, totalRequests: 3 }],
    });
    expect(await database.getApiKeyUsageTotals("legacy-total")).toMatchObject({
      totalTokens: 9, totalCost: 0.5, totalRequests: 3, unknownCostRequests: 0,
    });
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

  it.each([
    [{ totalTokens: "1", totalCost: 0, totalRequests: 1 }, "totalTokens"],
    [{ totalTokens: 1, totalCost: 0, totalRequests: 1, unknownCostRequests: -1 }, "unknownCostRequests"],
    [{ totalTokens: 1, totalCost: 0, totalRequests: 1, unknownCostRequests: 0.5 }, "unknownCostRequests"],
    [{ totalTokens: 1, totalCost: 0, totalRequests: 1, unknownCostRequests: "1" }, "unknownCostRequests"],
    [{ totalTokens: 1, totalCost: 0, totalRequests: 1, unknownCostRequests: null }, "unknownCostRequests"],
    [{ totalTokens: 1, totalCost: Number.NaN, totalRequests: 1 }, "totalCost"],
    [{ totalTokens: 1, totalCost: 0, totalRequests: 1.5 }, "totalRequests"],
    [{ totalTokens: 1, totalCost: 0, totalRequests: 1, updatedAt: "2030-01-01T00:00:00" }, "updatedAt"],
  ])("rejects malformed imported usage totals atomically %#", async (invalidTotal, field) => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)`,
      ["existing", "sk-cafebabe", "Existing", "2026-01-01T00:00:00.000Z"],
    );

    await expect(database.importDb({
      apiKeys: [{ id: "imported", key: "sk-deadbeef" }],
      apiKeyUsageTotals: [{ apiKeyId: "imported", ...invalidTotal }],
    })).rejects.toThrow(field);

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
      usageEventReceipts: [],
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
  it.each([undefined, []])("cuts over unproven charged backups without inventing receipts (%j)", async (receipts) => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { getBillingEpoch, saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    const { createMediaJob, getMediaJob, finishMediaJob } = await import("@/lib/db/repos/mediaJobsRepo.js");
    const { createNativeResourceOwner, readNativeResourceOwner } = await import("../../src/sse/services/nativeResourceOwners.js");
    const db = await getAdapter();
    const billingEpoch = await getBillingEpoch();
    const identity = { provider: "openai", connectionId: "connection", resourceId: "resource" };
    const job = await createMediaJob({ ...identity, apiKeyId: "legacy", model: "model", endpoint: "/v1/videos", usageEventId: "terminal", billingEpoch });
    const owner = { ...identity, ownerId: "legacy", usageEventId: "native-terminal", billingEpoch };
    await createNativeResourceOwner(owner);
    const totals = { apiKeyId: "legacy", totalTokens: 9, totalCost: 0.5, totalRequests: 3, unknownCostRequests: 2 };
    const snapshot = await database.importDb({
      apiKeys: [{ id: "legacy", key: "sk-cutover" }],
      apiKeyUsageTotals: [totals],
      ...(receipts === undefined ? {} : { usageEventReceipts: receipts }),
    });
    expect(await database.getApiKeyUsageTotals("legacy")).toMatchObject(totals);
    expect(snapshot.usageEventReceipts).toEqual([]);
    expect(snapshot.usageEventReceiptsVersion).toBeNull();
    expect(snapshot.billingCutoverVersion).toBe(1);
    expect(snapshot.billingEpoch).not.toBe(billingEpoch);
    expect(await getMediaJob(identity, "legacy")).toBeNull();
    await expect(finishMediaJob(job, "legacy", { status: "succeeded" })).rejects.toThrow("billing epoch");
    await expect(createMediaJob(job)).rejects.toThrow("billing epoch");
    expect(await readNativeResourceOwner(identity.provider, identity.connectionId, identity.resourceId)).toBeNull();
    await expect(createNativeResourceOwner(owner)).rejects.toThrow("billing epoch");
    const event = { apiKey: "sk-cutover", usageEventId: "terminal", tokens: { prompt_tokens: 2, completion_tokens: 1 }, cost: 0.25, strict: true };
    await expect(saveRequestUsage({ ...event, billingEpoch })).rejects.toThrow("billing epoch");
    await expect(saveRequestUsage(event)).rejects.toThrow("billing epoch");
    expect(await database.getApiKeyUsageTotals("legacy")).toMatchObject(totals);
    const current = await getBillingEpoch();
    await createMediaJob({ ...job, billingEpoch: current });
    await createNativeResourceOwner({ ...owner, billingEpoch: current });
    expect(await readNativeResourceOwner(identity.provider, identity.connectionId, identity.resourceId)).toMatchObject({ billingEpoch: current });
    await saveRequestUsage({ ...event, billingEpoch: current });
    await saveRequestUsage({ ...event, billingEpoch: current });
    expect(await database.getApiKeyUsageTotals("legacy")).toMatchObject({ totalTokens: 12, totalCost: 0.75, totalRequests: 4, unknownCostRequests: 2 });
    expect(db.get("SELECT usageEventId FROM usageHistory").usageEventId).toBe(JSON.stringify(["billing", current, "terminal"]));
    const backup = await database.exportDb();
    const restored = await database.importDb(backup);
    expect(restored.billingEpoch).not.toBe(current);
    expect(restored.usageEventReceipts).toEqual(backup.usageEventReceipts);
    expect(restored.usageEventReceiptsVersion).toBeNull();
    expect(await getMediaJob(identity, "legacy")).toBeNull();
    await expect(saveRequestUsage({ ...event, billingEpoch: current })).rejects.toThrow("billing epoch");
    expect(await database.getApiKeyUsageTotals("legacy")).toMatchObject({ totalTokens: 12, totalCost: 0.75, totalRequests: 4 });
  });

  it("does not infer receipt completeness from an empty key ledger", async () => {
    // An existing legacy file has no exclusive-creation provenance, even when
    // its key ledger is empty. Do not model it by creating a new installation.
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(path.join(dbDir, "data.sqlite"), "");
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run("INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', '7') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    expect((await database.exportDb()).usageEventReceiptsVersion).toBeNull();
  });

  it.each([null, "modern-generation"])("restores snapshot A without B receipts and fences old replay for epoch %j", async (billingEpoch) => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { saveRequestUsage, getBillingEpoch } = await import("@/lib/db/repos/usageRepo.js");
    const { createMediaJob, getMediaJob, finishMediaJob } = await import("@/lib/db/repos/mediaJobsRepo.js");
    const db = await getAdapter();
    db.run("INSERT INTO apiKeys(id, key, createdAt) VALUES('modern', 'sk-modern', ?)", [new Date().toISOString()]);
    if (billingEpoch !== null) db.run("INSERT INTO kv(scope, key, value) VALUES('billing', 'epoch', ?)", [JSON.stringify(billingEpoch)]);
    const eventA = { apiKey: "sk-modern", usageEventId: "event-a", billingEpoch, cost: 0.5, tokens: { prompt_tokens: 3 }, strict: true };
    await saveRequestUsage(eventA);
    const snapshotA = await database.exportDb();
    expect(snapshotA.usageEventReceiptsVersion).toBe(1);
    const eventB = { ...eventA, usageEventId: "event-b", cost: 0.25 };
    await saveRequestUsage(eventB);
    const job = await createMediaJob({ provider: "openai", connectionId: "connection", resourceId: "modern", apiKeyId: "modern", model: "model", endpoint: "/v1/videos", usageEventId: "event-b", billingEpoch });
    expect(await database.getApiKeyUsageTotals("modern")).toMatchObject({ totalTokens: 6, totalCost: 0.75, totalRequests: 2 });
    const restored = await database.importDb(snapshotA);
    expect(restored.usageEventReceipts).toEqual(snapshotA.usageEventReceipts);
    expect(restored.billingEpoch).not.toBe(billingEpoch);
    expect(await getMediaJob(job, "modern")).toBeNull();
    await expect(finishMediaJob(job, "modern", { status: "succeeded" })).rejects.toThrow("billing epoch");
    for (const event of [eventA, eventB]) await expect(saveRequestUsage(event)).rejects.toThrow("billing epoch");
    expect(await database.getApiKeyUsageTotals("modern")).toMatchObject({ totalTokens: 3, totalCost: 0.5, totalRequests: 1 });
    // Export and pruning must not backfill B from retained analytics.
    expect((await database.exportDb()).usageEventReceipts).toEqual(snapshotA.usageEventReceipts);
    await database.resetUsageHistory("all");
    expect((await database.exportDb()).usageEventReceipts).toEqual(snapshotA.usageEventReceipts);
    const fresh = { ...eventB, billingEpoch: await getBillingEpoch() };
    await saveRequestUsage(fresh);
    await saveRequestUsage(fresh);
    expect(await database.getApiKeyUsageTotals("modern")).toMatchObject({ totalTokens: 6, totalCost: 0.75, totalRequests: 2 });
  });

  it("rejects sql.js restore before mutation while ordinary fallback accounting still works", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const native = await getAdapter();
    native.checkpoint();
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const signals = ["beforeExit", "SIGINT", "SIGTERM"];
    const listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
    const fallback = await createSqlJsAdapter(path.join(tempDir, "db", "data.sqlite"));
    global._dbAdapter.instance = fallback;
    try {
      fallback.run("INSERT INTO apiKeys(id, key, createdAt) VALUES('fallback', 'sk-fallback', ?)", [new Date().toISOString()]);
      const usage = { apiKey: "sk-fallback", usageEventId: "fallback-a", cost: 0.25, strict: true };
      await database.saveRequestUsage(usage);
      const snapshot = await database.exportDb();
      const before = Buffer.from(fallback.raw.export());
      const run = vi.spyOn(fallback, "run");
      const transaction = vi.spyOn(fallback, "transaction");
      await expect(database.importDb(snapshot)).rejects.toThrow("transactional engine");
      expect(run).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(Buffer.from(fallback.raw.export())).toEqual(before);
      run.mockRestore();
      transaction.mockRestore();
      await database.saveRequestUsage({ ...usage, usageEventId: "fallback-b" });
      expect(await database.getApiKeyUsageTotals("fallback")).toMatchObject({ totalRequests: 2, totalCost: 0.5 });
    } finally {
      fallback.close();
      for (const signal of signals) {
        for (const listener of process.listeners(signal)) {
          if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
        }
      }
      global._dbAdapter.instance = native;
    }
  });
});
