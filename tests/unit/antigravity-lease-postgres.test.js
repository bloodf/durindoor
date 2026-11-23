import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const url = process.env.DURINDOOR_TEST_PG_URL;

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
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      expect(lease.acquireAntigravityLease(db, { connectionId: "crash", refreshToken: "synthetic", owner: "survivor", force: true }))
        .toMatchObject({ ok: false, category: "uncertain_dispatch" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 20_000);
});
