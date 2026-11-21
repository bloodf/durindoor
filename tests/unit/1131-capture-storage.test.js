import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-1131-"));
const original = process.env.DATA_DIR;
process.env.DATA_DIR = dir;
const session = "550e8400-e29b-41d4-a716-446655440000";
let db, capture, settings;

beforeAll(async () => {
  const driver = await import("@/lib/db/driver.js");
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
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("session capture storage", () => {
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
    const args = { credential: "secret-owner", session, consent: true, turn: { authorization: "private", text: "secret-owner Bearer abc sk-foobar", nested: { apiKey: "hidden" } } };
    expect(await capture.captureSessionTurn(args)).toBe(true);
    const rows = await capture.readSessionTurns(args);
    expect(JSON.stringify(rows)).not.toMatch(/secret-owner|private|abc|sk-foobar|hidden/);
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
    expect(db.get('SELECT COUNT(*) AS n FROM "sessionCaptureTurns"').n).toBe(0);
  });
});
