// In-process cutover/rollback mutex.
//
// HTTP write paths (via wrapCutoverGuard on the live adapter) reject
// INSERT/UPDATE/DELETE/DDL while the lock is held. The cutover pipeline
// opens its own unguarded adapters for migrate/mirror/snapshot, so those
// writes are not blocked. Readers (SELECT) keep serving.

let lockHeld = false;
const waiters = [];

export async function acquireCutoverLock() {
  if (!lockHeld) {
    lockHeld = true;
    return;
  }
  await new Promise((resolve) => waiters.push(resolve));
  lockHeld = true;
}

export function releaseCutoverLock() {
  lockHeld = false;
  const next = waiters.shift();
  if (next) next();
}

export function isCutoverInFlight() {
  return lockHeld;
}

const READ_PREFIX = /^(SELECT|SHOW|SET|PRAGMA)\b/i;

/**
 * Throw when a mutating statement runs on the live adapter during cutover.
 * `sql` may be a transaction BEGIN — that is also a write.
 */
export function guardWrites(sql) {
  if (!lockHeld) return;
  const s = String(sql || "").trim();
  if (!s || READ_PREFIX.test(s)) return;
  const err = new Error("database cutover in progress");
  err.code = "CUTOVER_IN_FLIGHT";
  throw err;
}

/**
 * Wrap the live adapter so HTTP traffic cannot mutate SQLite/PG while
 * cutover holds the lock. Fresh adapters opened by the pipeline itself
 * must NOT be wrapped.
 */
export function wrapCutoverGuard(adapter) {
  if (!adapter || adapter.__cutoverGuarded) return adapter;
  const origRun = adapter.run.bind(adapter);
  const origExec = adapter.exec.bind(adapter);
  const origTx = adapter.transaction.bind(adapter);
  return {
    ...adapter,
    run(sql, params) {
      guardWrites(sql);
      return origRun(sql, params);
    },
    exec(sql) {
      guardWrites(sql);
      return origExec(sql);
    },
    transaction(fn) {
      guardWrites("BEGIN");
      return origTx(fn);
    },
    __cutoverGuarded: true,
  };
}
