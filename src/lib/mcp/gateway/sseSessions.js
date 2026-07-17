// Per-session registry for SSE transport. Each gateway SSE connection gets
// a sessionId; the message route looks up the send function via that id.
//
// SINGLE-WORKER CONSTRAINT: the store is a process-local Map on globalThis.
// It is shared across HMR/module reloads within one Next.js worker but NOT
// across workers or instances — a session registered in worker A is invisible
// to worker B. Deployments with >1 worker need sticky routing or a shared
// store; multi-worker support is explicitly OUT OF SCOPE here.

import { v4 as uuidv4 } from "uuid";

const KEY = "__9routerGatewaySse";
const SESSION_TTL_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

/** @type {ReturnType<typeof setInterval> | null} lazily started sweeper */
let sweepTimer = null;

function getStore() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = new Map();
  }
  return globalThis[KEY];
}

/**
 * Delete sessions idle longer than SESSION_TTL_MS (no getSession refresh
 * since lastSeenAt). Runs on the shared unref'd sweep timer.
 */
function sweep() {
  const store = getStore();
  const now = Date.now();
  for (const [sid, entry] of store) {
    if (now - entry.lastSeenAt > SESSION_TTL_MS) store.delete(sid);
  }
}

/**
 * Start the sweep interval on first session registration. Unref'd so it
 * never keeps the process alive; subsequent registrations reuse the timer.
 */
function ensureSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

/**
 * Register an outbound send callback for a new SSE session.
 * @param {(chunk: string) => void} sendFn
 * @returns {string} session id
 */
export function registerSession(sendFn) {
  ensureSweeper();
  const sid = uuidv4();
  const now = Date.now();
  getStore().set(sid, { send: sendFn, createdAt: now, lastSeenAt: now });
  return sid;
}

/**
 * Unregister an SSE session.
 * @param {string} sid
 */
export function unregisterSession(sid) {
  getStore().delete(sid);
}

/**
 * Look up an SSE session by id. Refreshes lastSeenAt on hit so active
 * sessions never age out under the TTL sweep.
 * @param {string} sid
 * @returns {{send: (chunk: string) => void, createdAt: number, lastSeenAt: number} | null}
 */
export function getSession(sid) {
  const entry = getStore().get(sid);
  if (!entry) return null;
  entry.lastSeenAt = Date.now();
  return entry;
}

/** Test hooks — stop the sweeper and inspect store without process state. */
export const __test__ = {
  getStore,
  sweep,
  SESSION_TTL_MS,
  SWEEP_INTERVAL_MS,
  stopSweeper() {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  },
};
