import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let originalDataDir;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-group-backup-"));
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

describe("connection-group database backup", () => {
  it("round-trips groups, memberships, combo fields, credentials, and usage identity", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { backupDbLite } = await import("@/lib/db/backup.js");
    const { openSqliteAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const createdAt = "2026-09-05T00:00:00.000Z";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, 1, ?, ?, ?)`,
      ["conn-1", "openai", "apikey", "Primary", JSON.stringify({ apiKey: "sk-backup", customField: "kept" }), createdAt, createdAt]
    );
    db.run(`INSERT INTO connectionGroups(id, name, description, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`, ["group-1", "Production", "primary routes", createdAt, createdAt]);
    db.run(`INSERT INTO connectionGroupMembers(groupId, connectionId, createdAt) VALUES(?, ?, ?)`, ["group-1", "conn-1", createdAt]);
    db.run(
      `INSERT INTO combos(id, name, kind, models, invariant, allowedConnectionIds, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      ["combo-1", "fast", "weighted", JSON.stringify([{ provider: "openai", model: "gpt-test" }]), JSON.stringify({ allowedProviders: ["openai"] }), JSON.stringify(["conn-1"]), createdAt, createdAt]
    );
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, status, tokens, meta, comboId, comboName) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [createdAt, "openai", "gpt-test", "conn-1", "ok", "{}", "{}", "combo-1", "fast"]
    );

    const snapshot = await database.exportDb({ includeSecrets: true });
    expect(snapshot.connectionGroups).toEqual([{ id: "group-1", name: "Production", description: "primary routes", createdAt, updatedAt: createdAt }]);
    expect(snapshot.connectionGroupMembers).toEqual([{ groupId: "group-1", connectionId: "conn-1", createdAt }]);
    expect(snapshot.combos[0]).toMatchObject({ invariant: { allowedProviders: ["openai"] }, allowedConnectionIds: ["conn-1"] });
    expect(snapshot.providerConnections[0]).toMatchObject({ apiKey: "sk-backup", customField: "kept" });

    const backupDir = path.join(tempDir, "backup");
    fs.mkdirSync(backupDir);
    const backupPath = backupDbLite(db, backupDir);
    expect(backupPath).toBe(path.join(backupDir, "data.sqlite"));
    const backupDb = await openSqliteAdapter(backupPath);
    expect(backupDb.get(`SELECT groupId, connectionId FROM connectionGroupMembers`)).toEqual({ groupId: "group-1", connectionId: "conn-1" });
    expect(backupDb.get(`SELECT invariant, allowedConnectionIds FROM combos WHERE id = 'combo-1'`)).toEqual({ invariant: JSON.stringify({ allowedProviders: ["openai"] }), allowedConnectionIds: JSON.stringify(["conn-1"]) });
    expect(backupDb.get(`SELECT comboId, comboName FROM usageHistory`)).toEqual({ comboId: "combo-1", comboName: "fast" });
    await backupDb.close();

    process.env.DATA_DIR = path.join(tempDir, "fresh");
    await database.importDb(snapshot);
    const freshDb = await getAdapter();
    expect(freshDb.get(`SELECT name, description FROM connectionGroups WHERE id = 'group-1'`)).toEqual({ name: "Production", description: "primary routes" });
    expect(freshDb.get(`SELECT groupId, connectionId FROM connectionGroupMembers`)).toEqual({ groupId: "group-1", connectionId: "conn-1" });
    expect(freshDb.get(`SELECT invariant, allowedConnectionIds FROM combos WHERE id = 'combo-1'`)).toEqual({ invariant: JSON.stringify({ allowedProviders: ["openai"] }), allowedConnectionIds: JSON.stringify(["conn-1"]) });
    expect(await database.getProviderConnectionById("conn-1")).toMatchObject({ apiKey: "sk-backup", customField: "kept" });
  });

  it("rejects dangling memberships before destructive restore", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO connectionGroups(id, name, createdAt, updatedAt) VALUES('existing', 'Existing', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')`);

    await expect(database.importDb({
      providerConnections: [],
      connectionGroups: [{ id: "group-1", name: "Imported" }],
      connectionGroupMembers: [{ groupId: "group-1", connectionId: "missing" }],
    })).rejects.toThrow("references a missing provider connection");
    expect(db.get(`SELECT id, name FROM connectionGroups WHERE id = 'existing'`)).toEqual({ id: "existing", name: "Existing" });
  });
});
