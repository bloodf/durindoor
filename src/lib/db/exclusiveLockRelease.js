/**
 * Release an exclusive SQLite lock by closing the handle that holds it.
 *
 * The outcome is per handle, not per database. `CLOSED` says this adapter went
 * from open to closed; it does not say the file is free, that a successor may
 * read it, or that another holder in this or another process is gone.
 *
 * Standalone contract: no DurinDoor code path calls this yet. A caller must
 * own the adapter it passes in and must not use the handle after `CLOSED`.
 */

/** Why a release reported `REFUSED_STILL_OPEN`. */
export const STILL_OPEN_REASONS = Object.freeze({
  /** The close threw and the handle still reports open: end the cursor, then retry. */
  CLOSE_THREW: "CLOSE_THREW",
  /** The close returned and the handle still reports open: retrying changes nothing. */
  OPEN_STILL_TRUE: "OPEN_STILL_TRUE",
  /** The state read failed or was not a boolean after the close: nothing was observed. */
  OPEN_WITNESS_UNREADABLE: "OPEN_WITNESS_UNREADABLE",
});

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function stillOpen(reason, failure) {
  return failure === undefined
    ? { kind: "REFUSED_STILL_OPEN", reason }
    : { kind: "REFUSED_STILL_OPEN", reason, message: failure };
}

/**
 * Close `adapter` unless it is mid-transaction or its transaction state cannot
 * be read (including adapters that expose none, such as sql.js).
 *
 * Never throws and never sets a pragma: with a live cursor the pragma is the
 * statement that throws, so setting one would never reach `close()` and would
 * report a refusal for the wrong reason.
 *
 * The observed `open` state, not the close call, decides the outcome: a driver
 * may close and then throw, and an adapter may swallow the driver's refusal.
 * `OPEN_WITNESS_UNREADABLE` does not mean the handle is still open; the close
 * was attempted and the state read failed, so do not reuse or blindly retry.
 *
 * @param {{ inTransaction?: unknown, open?: unknown, close: () => void }} adapter
 * @returns {{ kind: "CLOSED" }
 *   | { kind: "REFUSED_OPEN_TRANSACTION" }
 *   | { kind: "REFUSED_UNKNOWN_TRANSACTION" }
 *   | { kind: "REFUSED_STILL_OPEN", reason: string, message?: string }}
 */
export function releaseExclusiveLock(adapter) {
  let inTransaction;
  try {
    inTransaction = adapter.inTransaction;
  } catch {
    return { kind: "REFUSED_UNKNOWN_TRANSACTION" };
  }
  // Closing would discard the open transaction without a rollback the caller can see.
  if (inTransaction === true) return { kind: "REFUSED_OPEN_TRANSACTION" };
  if (inTransaction !== false) return { kind: "REFUSED_UNKNOWN_TRANSACTION" };

  let failure;
  try {
    adapter.close();
  } catch (error) {
    failure = messageOf(error);
  }

  let open;
  try {
    open = adapter.open;
  } catch {
    return stillOpen(STILL_OPEN_REASONS.OPEN_WITNESS_UNREADABLE, failure);
  }
  // A close that took effect stays closed even if the call threw afterwards.
  if (open === false) return { kind: "CLOSED" };
  if (open === true) {
    return failure === undefined
      ? stillOpen(STILL_OPEN_REASONS.OPEN_STILL_TRUE)
      : stillOpen(STILL_OPEN_REASONS.CLOSE_THREW, failure);
  }
  // Only `false` shows the close happened; anything else is unreadable.
  return stillOpen(STILL_OPEN_REASONS.OPEN_WITNESS_UNREADABLE, failure);
}
