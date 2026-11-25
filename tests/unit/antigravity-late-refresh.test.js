import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OLD_TOKEN = "refresh-old";
const NEW_TOKEN = "refresh-rotated";

let tempDir;
let originalDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-late-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function setup(id) {
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, 'antigravity', 'oauth', 'agy', 'hidden@example.com', 1, 1, ?, ?, ?)`,
    [id, JSON.stringify({ refreshToken: OLD_TOKEN, providerSpecificData: { projectId: "project-1" } }), now, now]
  );
  const lease = await import("../../src/lib/antigravity/leaseSql.js");
  const { exchangeAntigravityRefresh } = await import("../../src/lib/antigravity/refreshProtocol.js");
  return { db, lease, exchangeAntigravityRefresh };
}

function expireLease(db, id) {
  db.run(`UPDATE antigravityRefreshLeases SET leaseExpiresAt = 1 WHERE connectionId = ?`, [id]);
}

async function storedRefreshToken(id) {
  const { getProviderConnectionById } = await import("../../src/lib/db/repos/connectionsRepo.js");
  return (await getProviderConnectionById(id)).refreshToken;
}

function leaseRow(db, id) {
  return db.get(`SELECT * FROM antigravityRefreshLeases WHERE connectionId = ?`, [id]);
}

const rotated = { ok: true, tokens: { accessToken: "synthetic-access", refreshToken: NEW_TOKEN, expiresIn: 3600 } };

function credentials(id) {
  return { id, connectionId: id, provider: "antigravity", authType: "oauth", refreshToken: OLD_TOKEN, providerSpecificData: { projectId: "project-1" } };
}

describe("antigravity refresh completing after lease expiry", () => {
  it("commits a late success when generation and fencing token are unchanged", async () => {
    const { db, lease, exchangeAntigravityRefresh } = await setup("late-ok");
    const result = await exchangeAntigravityRefresh({
      connectionId: "late-ok",
      credentials: credentials("late-ok"),
      dispatch: async () => { expireLease(db, "late-ok"); return rotated; },
    });
    expect(result).toMatchObject({ accessToken: "synthetic-access", refreshToken: NEW_TOKEN, rotationCommitted: true });
    expect(await storedRefreshToken("late-ok")).toBe(NEW_TOKEN);
    expect(leaseRow(db, "late-ok")).toMatchObject({ attemptState: "idle", owner: null, fencingToken: null });
    expect(lease.acquireAntigravityLease(db, { connectionId: "late-ok", refreshToken: NEW_TOKEN, owner: "next" }).ok).toBe(true);
  });

  it("discards a late success after another caller observed the expiry", async () => {
    const { db, lease, exchangeAntigravityRefresh } = await setup("late-observed");
    const result = await exchangeAntigravityRefresh({
      connectionId: "late-observed",
      credentials: credentials("late-observed"),
      dispatch: async () => {
        expireLease(db, "late-observed");
        expect(lease.acquireAntigravityLease(db, { connectionId: "late-observed", refreshToken: OLD_TOKEN, owner: "other" }))
          .toMatchObject({ ok: false, category: "uncertain_dispatch" });
        return rotated;
      },
    });
    expect(result).toEqual({ blocked: true, category: "uncertain_dispatch" });
    expect(await storedRefreshToken("late-observed")).toBe(OLD_TOKEN);
    expect(leaseRow(db, "late-observed")).toMatchObject({ attemptState: "uncertain", errorCategory: "uncertain_dispatch" });
  });

  it.each([
    ["management fence", (lease, db, id) => db.transaction(() => lease.fenceAntigravityRecovery(db, id))],
    ["generation advance", (lease, db, id) => lease.advanceAntigravityGeneration(db, id, OLD_TOKEN)],
  ])("discards a late success after a %s", async (_name, act) => {
    const { db, lease, exchangeAntigravityRefresh } = await setup("late-fenced");
    const result = await exchangeAntigravityRefresh({
      connectionId: "late-fenced",
      credentials: credentials("late-fenced"),
      dispatch: async () => { expireLease(db, "late-fenced"); act(lease, db, "late-fenced"); return rotated; },
    });
    expect(result).toEqual({ blocked: true, category: "uncertain_dispatch" });
    expect(await storedRefreshToken("late-fenced")).toBe(OLD_TOKEN);
    expect(leaseRow(db, "late-fenced")).toMatchObject({ attemptState: "uncertain", owner: null });
  });

  it("rejects a stale fencing token on an expired lease", async () => {
    const { db, lease } = await setup("late-stale");
    const claimed = lease.acquireAntigravityLease(db, { connectionId: "late-stale", refreshToken: OLD_TOKEN, owner: "a" });
    expect(lease.markAntigravityDispatched(db, claimed.lease)).toBe(true);
    expireLease(db, "late-stale");
    const stale = { ...claimed.lease, fencingToken: "not-the-token" };
    expect(lease.clearAntigravityLease(db, stale, NEW_TOKEN)).toBe(false);
    expect(lease.renewAntigravityLease(db, stale)).toBe(false);
    expect(leaseRow(db, "late-stale").attemptState).toBe("dispatched");
  });

  it("refuses to mark an expired claim dispatched", async () => {
    const { db, lease } = await setup("late-renew");
    const claimed = lease.acquireAntigravityLease(db, { connectionId: "late-renew", refreshToken: OLD_TOKEN, owner: "a" });
    expireLease(db, "late-renew");
    expect(lease.markAntigravityDispatched(db, claimed.lease)).toBe(false);
  });
});
