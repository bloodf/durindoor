import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const url = process.env.DURINDOOR_TEST_PG_URL;
// scripts/test-postgres-fencing.mjs sets this so its run can never pass by skipping.
if (!url && process.env.DURINDOOR_TEST_PG_REQUIRED === "1") {
  throw new Error("DURINDOOR_TEST_PG_REQUIRED=1 but DURINDOOR_TEST_PG_URL is not set; refusing to skip PostgreSQL fencing coverage");
}

const raceWorker = fileURLToPath(new URL("./antigravity-pg-race-worker.js", import.meta.url));

// Runs one process per op so each has its own production adapter and server
// connection. A separate transaction first locks the writer row and the lease
// row; every worker is released and must be observed blocked on a lock before
// that transaction commits. The calls therefore contend on PostgreSQL itself
// instead of being serialized by process start-up or IPC timing. With
// `ordered`, workers are queued one at a time, so the lock queue fixes which
// op runs first.
async function race(pgUrl, connectionId, ops, { ordered = false } = {}) {
  const holder = new pg.Client({ connectionString: pgUrl });
  await holder.connect();
  const children = ops.map(() => fork(raceWorker, [], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, AGY_TEST_PG_URL: pgUrl },
    execArgv: [],
  }));
  const settle = (child, type) => new Promise((resolve, reject) => {
    const onMessage = (message) => { if (message?.type === type) { child.off("message", onMessage); resolve(message); } };
    child.on("message", onMessage);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`race worker exited before ${type}: ${code}`)));
  });
  let open = false;
  try {
    await Promise.all(children.map((child) => settle(child, "ready")));
    await holder.query("BEGIN");
    open = true;
    await holder.query("SELECT value FROM _meta WHERE key = 'schemaVersion' FOR UPDATE");
    expect((await holder.query("SELECT 1 FROM \"antigravityRefreshLeases\" WHERE \"connectionId\" = $1 FOR UPDATE", [connectionId])).rowCount).toBe(1);
    const results = children.map((child) => settle(child, "result"));
    results.forEach((result) => result.catch(() => {}));
    const waitForBlocked = async (expected) => {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { rows } = await holder.query(
          "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'"
        );
        if (rows[0].waiting === expected) return;
        if (Date.now() > deadline) throw new Error(`only ${rows[0].waiting}/${expected} workers reached the lock`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    for (const [index, child] of children.entries()) {
      child.send({ type: "go", ...ops[index] });
      if (ordered) await waitForBlocked(index + 1);
    }
    await waitForBlocked(ops.length);
    await holder.query("COMMIT");
    open = false;
    return (await Promise.all(results)).map(({ result }) => {
      if (result?.error) throw new Error(result.error);
      return result;
    });
  } finally {
    if (open) await holder.query("ROLLBACK").catch(() => {});
    await holder.end().catch(() => {});
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

describe.skipIf(!url)("Antigravity management fence on disposable PostgreSQL", () => {
  let db;
  let lease;
  let admin;
  let testUrl;
  const database = `dd_lease_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    const { createPostgresAdapter } = await import("../../src/lib/db/adapters/pgAdapter.js");
    const { runMigrationOnce } = await import("../../src/lib/db/migrate.js");
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    testUrl = new URL(url);
    testUrl.pathname = `/${database}`;
    db = await createPostgresAdapter({ url: testUrl.toString() });
    await runMigrationOnce(db);
    lease = await import("../../src/lib/antigravity/leaseSql.js");
  }, 60_000);

  afterAll(async () => {
    await db?.close();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    }
  });

  it.each([false, true])("blocks replay after fencing a dispatched exchange (delete: %s)", (deleteCredential) => {
    const id = `fence-${deleteCredential}`;
    const first = lease.acquireAntigravityLease(db, { connectionId: id, refreshToken: "old-synthetic", owner: "first" });
    expect(first.ok).toBe(true);
    expect(lease.markAntigravityDispatched(db, first.lease)).toBe(true);
    db.transaction(() => lease.fenceAntigravityRecovery(db, id, { deleteCredential }));
    expect(lease.clearAntigravityLease(db, first.lease, "rotated-synthetic")).toBe(false);
    expect(lease.acquireAntigravityLease(db, { connectionId: id, refreshToken: "old-synthetic", owner: "second", force: true }))
      .toMatchObject({ ok: false, category: "uncertain_dispatch" });
    lease.advanceAntigravityGeneration(db, id, "old-synthetic");
    expect(lease.acquireAntigravityLease(db, { connectionId: id, refreshToken: "old-synthetic", owner: "third" }))
      .toMatchObject({ ok: false, category: "uncertain_dispatch" });
    lease.advanceAntigravityGeneration(db, id, "new-synthetic");
    expect(lease.acquireAntigravityLease(db, { connectionId: id, refreshToken: "old-synthetic", owner: "stale" }).ok).toBe(false);
    expect(lease.acquireAntigravityLease(db, { connectionId: id, refreshToken: "new-synthetic", owner: "fresh" }).ok).toBe(true);
  });

  it("grants exactly one lease when separate processes race one connection", async () => {
    const contenders = 6;
    lease.seedAntigravityLease(db, "race-acquire", "synthetic");
    const results = await race(testUrl.toString(), "race-acquire", Array.from({ length: contenders }, (_, index) => ({
      op: "acquire",
      args: { connectionId: "race-acquire", refreshToken: "synthetic", owner: `racer-${index}` },
    })));
    const winners = results.filter((result) => result.ok);
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: contenders - 1 }, () => expect.objectContaining({ ok: false, category: "busy" }))
    );
    const row = db.get("SELECT owner, fencingToken, attemptState FROM antigravityRefreshLeases WHERE connectionId = ?", ["race-acquire"]);
    expect(row).toEqual({ owner: winners[0].lease.owner, fencingToken: winners[0].lease.fencingToken, attemptState: "claimed" });
  }, 30_000);

  it("never leaves a replayable lease when fencing races dispatch", async () => {
    for (let round = 0; round < 6; round += 1) {
      const id = `race-fence-${round}`;
      const held = lease.acquireAntigravityLease(db, { connectionId: id, refreshToken: "synthetic", owner: "holder" });
      expect(held.ok).toBe(true);
      const dispatchFirst = round % 2 === 0;
      const dispatchOp = { op: "dispatch", args: held.lease };
      const fenceOp = { op: "fence", args: { connectionId: id, options: { deleteCredential: round % 4 >= 2 } } };
      const results = await race(testUrl.toString(), id, dispatchFirst ? [dispatchOp, fenceOp] : [fenceOp, dispatchOp], { ordered: true });
      const dispatch = results[dispatchFirst ? 0 : 1];
      expect(dispatch.ok).toBe(dispatchFirst);
      // In either order, the stale lease cannot complete.
      expect(lease.clearAntigravityLease(db, held.lease, "rotated-synthetic")).toBe(false);
      const row = db.get("SELECT attemptState, owner, fencingToken, generation FROM antigravityRefreshLeases WHERE connectionId = ?", [id]);
      expect(row).toMatchObject({ owner: null, fencingToken: null, generation: held.lease.generation + 1 });
      const next = lease.acquireAntigravityLease(db, { connectionId: id, refreshToken: "synthetic", owner: "next", force: true });
      if (dispatch.ok) {
        expect(row.attemptState).toBe("uncertain");
        expect(next).toMatchObject({ ok: false, category: "uncertain_dispatch" });
      } else {
        expect(row.attemptState).toBe("idle");
        expect(next.ok).toBe(true);
        expect(next.lease.generation).toBe(held.lease.generation + 1);
      }
    }
  }, 60_000);

  it("keeps a dispatch uncertain after management fencing and worker death", async () => {
    const child = fork(fileURLToPath(new URL("./antigravity-pg-fence-worker.js", import.meta.url)), [], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, AGY_TEST_PG_URL: testUrl.toString() },
      execArgv: [],
    });
    try {
      const result = await new Promise((resolve, reject) => {
        child.once("message", resolve);
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`worker exited before dispatch: ${code}`)));
      });
      expect(result.ok).toBe(true);
      db.transaction(() => lease.fenceAntigravityRecovery(db, "crash", { deleteCredential: true }));
      // The fenced worker's own completion must be rejected before it dies.
      const staleResult = new Promise((resolve, reject) => {
        child.once("message", resolve);
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`worker exited before stale completion: ${code}`)));
      });
      child.send("complete");
      expect(await staleResult).toEqual({ cleared: false });
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      expect(lease.acquireAntigravityLease(db, { connectionId: "crash", refreshToken: "synthetic", owner: "survivor", force: true }))
        .toMatchObject({ ok: false, category: "uncertain_dispatch" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 20_000);
});
