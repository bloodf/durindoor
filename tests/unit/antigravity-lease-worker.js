import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { acquireAntigravityLease, markAntigravityDispatched } from "../../src/lib/antigravity/leaseSql.js";

if (isMainThread && process.env.AGY_HOLD === "1") {
  const db = createBetterSqliteAdapter(process.env.AGY_DB_FILE);
  try {
    const result = acquireAntigravityLease(db, {
      connectionId: process.env.AGY_CONNECTION,
      refreshToken: process.env.AGY_TOKEN,
      owner: "killed-worker",
    });
    const marked = result.ok === true && markAntigravityDispatched(db, result.lease);
    process.send?.({ phase: "held", ok: marked });
    await new Promise(() => {});
  } catch {
    process.send?.({ phase: "held", ok: false });
  } finally {
    db.close();
  }
} else {
  const db = createBetterSqliteAdapter(workerData.file);
  try {
    parentPort.postMessage({ phase: "started" });
    const result = acquireAntigravityLease(db, workerData.claim);
    parentPort.postMessage({ phase: "done", ok: result.ok === true, category: result.category || null });
  } catch {
    parentPort.postMessage({ phase: "done", ok: false, category: "pre_dispatch_failure" });
  } finally {
    db.close();
  }
}
