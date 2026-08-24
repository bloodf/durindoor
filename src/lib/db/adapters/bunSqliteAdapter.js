// Bun runtime adapter — uses built-in bun:sqlite (native, fastest under Bun).
// Loaded only when process.versions.bun is present.
import { PRAGMA_SQL } from "../schema.js";
import { assertCheckpointComplete } from "../helpers/checkpoint.js";
import { isFunction } from "@/shared/utils/typeChecks.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createBunSqliteAdapter(filePath) {
  // Dynamic import — only resolves under Bun runtime
  const { Database } = await import("bun:sqlite");
  const db = new Database(filePath, { create: true });
  db.exec(PRAGMA_SQL);

  const stmtCache = new Map();
  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  const checkpointTimer = setInterval(() => {
    try {db.exec("PRAGMA wal_checkpoint(TRUNCATE)");} catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (isFunction(checkpointTimer.unref)) checkpointTimer.unref();

  function gracefulClose() {
    try {db.exec("PRAGMA wal_checkpoint(TRUNCATE)");} catch {}
    try {stmtCache.clear();} catch {}
    try {db.close();} catch {}
  }
  const onSignal = () => {
    // Keep the repository available until the central MITM cleanup finishes.
    try {db.exec("PRAGMA wal_checkpoint(TRUNCATE)");} catch {}
  };
  process.once("beforeExit", gracefulClose);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return {
    driver: "bun:sqlite",
    capabilities: Object.freeze({ sharedFileTransactions: true }),
    run(sql, params = []) {
      const r = prepare(sql).run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    get(sql, params = []) {
      return prepare(sql).get(...params);
    },
    all(sql, params = []) {
      return prepare(sql).all(...params);
    },
    exec(sql) {return db.exec(sql);},
    transaction(fn) {
      // bun:sqlite has db.transaction() API (similar to better-sqlite3)
      const tx = db.transaction(fn);
      return tx();
    },
    checkpoint() {
      const row = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      return assertCheckpointComplete(row, "bun:sqlite");
    },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db
  };
}