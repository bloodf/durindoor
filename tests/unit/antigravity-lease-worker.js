import { parentPort, workerData } from "node:worker_threads";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { acquireAntigravityLease } from "../../src/lib/antigravity/leaseSql.js";

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
