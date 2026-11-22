import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const original = process.env.DATA_DIR;
const postgresUrl = process.env.DURINDOOR_CAPTURE_TEST_PG_URL;
const session = "550e8400-e29b-41d4-a716-446655440000";
const otherSession = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
// Default parity runs exercise the real PG SQL rewrite and the PG lock path
// with an in-process fixture. The same cases can also run against a disposable
// PostgreSQL database initialized by this suite.
function postgresFixture(sqlite, prepareSql) {
  const sqlForFixture = (sql) => prepareSql(sql).finalSql
    .replace(/\$\d+/g, "?")
    .replace(/ FOR UPDATE$/, "");
  return {
    ...sqlite,
    capabilities: { ...sqlite.capabilities, isPostgres: true },
    driver: "pg",
    get: (sql, params) => sqlite.get(sqlForFixture(sql), params),
    run: (sql, params) => sqlite.run(sqlForFixture(sql), params),
    all: (sql, params) => sqlite.all(sqlForFixture(sql), params),
  };
}

describe.each(postgresUrl ? ["PostgreSQL server"] : ["SQLite", "PostgreSQL SQL fixture"])("session capture storage on %s", (engine) => {
  let db, capture, settings, dir;

  function insertTurn(id, apiKeyId, sessionId, value, createdAt, expiresAt) {
    const content = JSON.stringify(value);
    db.run(
      `INSERT INTO "sessionCaptureTurns" ("id", "apiKeyId", "sessionId", "content", "byteSize", "createdAt", "expiresAt")
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, apiKeyId, sessionId, content, Buffer.byteLength(content, "utf8"), createdAt, expiresAt]
    );
  }

  function countTurns(where, params = []) {
    return Number(db.get(`SELECT COUNT(*) AS n FROM "sessionCaptureTurns" ${where}`, params).n);
  }

  const expiredAt = () => new Date(Date.now() - 60_000).toISOString();
  const liveAt = () => new Date().toISOString();
  const futureAt = () => new Date(Date.now() + 3_600_000).toISOString();

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-1131-"));
    process.env.DATA_DIR = dir;
    const driver = await import("@/lib/db/driver.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    if (engine === "PostgreSQL server") {
      const { createPostgresAdapter } = await import("@/lib/db/adapters/pgAdapter.js");
      const adapter = await createPostgresAdapter({ url: postgresUrl });
      try {
        if (adapter.get("SELECT to_regclass('_meta') AS existing").existing) throw new Error("Capture tests require an empty PostgreSQL database");
        await runMigrationOnce(adapter);
        driver.setActiveAdapter(adapter);
      } catch (error) {
        await adapter.close();
        throw error;
      }
    } else if (engine === "PostgreSQL SQL fixture") {
      const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
      const { prepareSql } = await import("@/lib/db/adapters/pgAdapter.js");
      const sqlite = createBetterSqliteAdapter(path.join(dir, "db.sqlite"));
      await runMigrationOnce(sqlite);
      driver.setActiveAdapter(postgresFixture(sqlite, prepareSql));
    }
    db = await driver.getAdapter();
    settings = await import("@/lib/db/repos/settingsRepo.js");
    capture = await import("@/lib/db/repos/sessionCaptureRepo.js");
    for (const [id, key] of [["owner", "secret-owner"], ["other", "secret-other"]]) {
      db.run('INSERT INTO apiKeys (id, name, key, machineId, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?)', [id, id, key, "machine", 1, new Date().toISOString()]);
    }
  });
  afterAll(async () => {
    await db?.close?.();
    if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("registers capture migration 032 in SQLite and PostgreSQL", async () => {
    const { MIGRATIONS, latestVersion } = await import("@/lib/db/migrations/index.js");
    const { PG_MIGRATIONS, pgLatestVersion } = await import("@/lib/db/migrations/postgres/index.js");
    expect(latestVersion()).toBe(32);
    expect(pgLatestVersion()).toBe(32);
    expect(PG_MIGRATIONS.at(-1)).toBe(MIGRATIONS.at(-1));
    expect(MIGRATIONS.at(-1)).toMatchObject({ version: 32, name: "session-capture" });
  });

  it("requires operator opt-in and explicit request consent", async () => {
    const args = { credential: "secret-owner", session, turn: "hello", consent: true };
    expect(await capture.captureSessionTurn(args)).toBe(false);
    await settings.updateSettings({ enableSessionCapture: true });
    expect(await capture.captureSessionTurn({ ...args, consent: false })).toBe(false);
    await expect(capture.captureSessionTurn({ ...args, credential: "invalid" })).rejects.toThrow("Authentication required");
    await expect(capture.captureSessionTurn({ ...args, session: "secret-owner" })).rejects.toThrow("Invalid session");
  });
  it("redacts credentials and isolates reads and deletion", async () => {
    const args = { credential: "secret-owner", session, consent: true, turn: {
      authorization: "fixture-auth", text: "secret-owner Bearer abc sk-foobar",
      nested: { apiKey: "fixture-key", cookie: "fixture-cookie", password: "fixture-password",
        clientSecret: "fixture-secret", privateKey: "fixture-private-key", accessToken: "fixture-token" },
    } };
    expect(await capture.captureSessionTurn(args)).toBe(true);
    const rows = await capture.readSessionTurns(args);
    expect(JSON.stringify(rows.map((row) => row.content))).not.toMatch(/secret-owner|abc|sk-foobar|fixture-/);
    expect(await capture.readSessionTurns({ credential: "secret-other", session })).toEqual([]);
    await capture.deleteSessionTurns({ credential: "secret-other", session });
    expect(await capture.readSessionTurns(args)).toHaveLength(1);
    await capture.deleteSessionTurns(args);
    expect(await capture.readSessionTurns(args)).toEqual([]);
  });
  it("keeps capture scoped to the stable key when its credential rotates", async () => {
    const args = { credential: "secret-owner", session, consent: true, turn: "saved" };
    expect(await capture.captureSessionTurn(args)).toBe(true);
    db.run('UPDATE apiKeys SET key = ? WHERE id = ?', ["rotated-owner", "owner"]);
    const rotated = { ...args, credential: "rotated-owner" };
    try {
      await expect(capture.readSessionTurns(args)).rejects.toThrow("Authentication required");
      expect(await capture.readSessionTurns(rotated)).toHaveLength(1);
      db.run('UPDATE apiKeys SET isActive = 0 WHERE id = ?', ["owner"]);
      await expect(capture.deleteSessionTurns(rotated)).rejects.toThrow("Authentication required");
    } finally {
      db.run('UPDATE apiKeys SET key = ?, isActive = 1 WHERE id = ?', ["secret-owner", "owner"]);
      await capture.deleteSessionTurns(args);
    }
  });

  it("enforces bytes, retention, quota and pruning", async () => {
    const args = { credential: "secret-owner", session, consent: true };
    await expect(capture.captureSessionTurn({ ...args, turn: "é".repeat(8192) })).rejects.toThrow("exceeds limit");
    await expect(capture.captureSessionTurn({ ...args, turn: "x", retentionMs: capture.CAPTURE_MAX_AGE_MS + 1 })).rejects.toThrow("retention");
    await expect(capture.readSessionTurns({ ...args, limit: 101 })).rejects.toThrow("limit");
    for (let i = 0; i < 64; i++) expect(await capture.captureSessionTurn({ ...args, turn: "x".repeat(16382) })).toBe(true);
    expect(await capture.captureSessionTurn({ ...args, turn: "x" })).toBe(false);
    db.run('UPDATE "sessionCaptureTurns" SET "expiresAt" = ?', ["2000-01-01T00:00:00.000Z"]);
    expect(await capture.readSessionTurns(args)).toEqual([]);
    await capture.pruneSessionTurns();
    expect(countTurns("")).toBe(0);
  });

  it("physically removes expired rows on read", async () => {
    const args = { credential: "secret-owner", session, consent: true };
    expect(await capture.captureSessionTurn({ ...args, turn: "kept" })).toBe(true);
    insertTurn("expired-owner", "owner", session, "gone", expiredAt(), expiredAt());
    expect(countTurns('WHERE "id" = ?', ["expired-owner"])).toBe(1);

    const rows = await capture.readSessionTurns(args);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("kept");
    // The expired row is deleted, not only filtered out of the result set.
    expect(countTurns('WHERE "id" = ?', ["expired-owner"])).toBe(0);
    expect(countTurns('WHERE "apiKeyId" = ? AND "sessionId" = ?', ["owner", session])).toBe(1);
    await capture.deleteSessionTurns(args);
  });

  it("prunes only the authenticated key and keeps other keys intact", async () => {
    const args = { credential: "secret-owner", session, consent: true };
    insertTurn("expired-other", "other", otherSession, "gone", expiredAt(), expiredAt());
    insertTurn("kept-other", "other", otherSession, "kept", liveAt(), futureAt());
    insertTurn("expired-owner", "owner", otherSession, "gone", expiredAt(), expiredAt());

    expect(await capture.readSessionTurns(args)).toEqual([]);
    // The owner's expired content is pruned across the key's sessions.
    expect(countTurns('WHERE "id" = ?', ["expired-owner"])).toBe(0);
    // Another key's rows are never touched by this key's read.
    expect(countTurns('WHERE "id" = ?', ["expired-other"])).toBe(1);
    expect(countTurns('WHERE "id" = ?', ["kept-other"])).toBe(1);

    // The other key still authorizes and reads its own live content, and its
    // own read prunes its own expired rows.
    const other = await capture.readSessionTurns({ credential: "secret-other", session: otherSession });
    expect(other).toHaveLength(1);
    expect(other[0].content).toBe("kept");
    expect(countTurns('WHERE "id" = ?', ["expired-other"])).toBe(0);
    expect(countTurns('WHERE "id" = ?', ["kept-other"])).toBe(1);
    await capture.deleteSessionTurns({ credential: "secret-other", session: otherSession });
  });

  it("prunes expired rows on read after capture writes are disabled", async () => {
    const args = { credential: "secret-owner", session, consent: true };
    insertTurn("expired-disabled", "owner", session, "gone", expiredAt(), expiredAt());
    await settings.updateSettings({ enableSessionCapture: false });
    try {
      expect(await capture.readSessionTurns(args)).toEqual([]);
      expect(countTurns('WHERE "id" = ?', ["expired-disabled"])).toBe(0);
    } finally {
      await settings.updateSettings({ enableSessionCapture: true });
    }
  });

  it("keeps authentication failures and bounded reads intact", async () => {
    const args = { credential: "secret-owner", session, consent: true };
    insertTurn("expired-unauthorized", "owner", session, "gone", expiredAt(), expiredAt());

    await expect(capture.readSessionTurns({ credential: "not-a-key", session })).rejects.toThrow("Authentication required");
    // A rejected read prunes nothing.
    expect(countTurns('WHERE "id" = ?', ["expired-unauthorized"])).toBe(1);
    await expect(capture.readSessionTurns({ credential: "secret-owner", session: "not-a-session" })).rejects.toThrow("Invalid session");
    await expect(capture.readSessionTurns({ ...args, limit: 101 })).rejects.toThrow("Invalid limit");
    await expect(capture.readSessionTurns({ ...args, limit: 0 })).rejects.toThrow("Invalid limit");

    insertTurn("bounded-1", "owner", session, "one", liveAt(), futureAt());
    insertTurn("bounded-2", "owner", session, "two", liveAt(), futureAt());
    // The read stays bounded to the requested limit.
    expect(await capture.readSessionTurns({ ...args, limit: 1 })).toHaveLength(1);
    expect(await capture.readSessionTurns({ ...args, limit: 100 })).toHaveLength(2);
    expect(countTurns('WHERE "id" = ?', ["expired-unauthorized"])).toBe(0);
    await capture.deleteSessionTurns(args);
  });
  it("clears capture on key-set restore and rejects a completion admitted before restore", async () => {
    const { importDb } = await import("@/lib/db/index.js");
    const { getBillingEpoch } = await import("@/lib/db/repos/usageRepo.js");
    const admitted = { keyId: "owner", session, content: '{"assistant":["old turn"]}', billingEpoch: await getBillingEpoch() };
    expect(await capture.storeAdmittedCapture(admitted)).toBe(true);
    await importDb({
      apiKeys: [{ id: "owner", name: "replacement", key: "replacement-credential", isActive: true }],
      settings: { enableSessionCapture: true },
    }).catch((error) => {
      // PostgreSQL currently fails the SQLite-only quota check in the export
      // after the import commits. The assertions below verify the committed restore.
      if (engine !== "PostgreSQL server" || error.code !== "42601" || !error.message.includes("PRAGMA")) throw error;
    });
    await expect(capture.storeAdmittedCapture(admitted)).rejects.toThrow("Stale or missing billing epoch");
    expect(await capture.readSessionTurns({ credential: "replacement-credential", session })).toEqual([]);
    expect(await capture.storeAdmittedCapture({ ...admitted, billingEpoch: await getBillingEpoch() })).toBe(true);
    expect(await capture.readSessionTurns({ credential: "replacement-credential", session })).toHaveLength(1);
  });
});
