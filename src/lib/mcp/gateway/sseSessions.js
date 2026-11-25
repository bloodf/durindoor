// Per-session registry for SSE transport. Each gateway SSE connection gets
// a sessionId; the message route looks up the send function via that id.
//
// SINGLE-WORKER CONSTRAINT: the store is a process-local Map on globalThis.
// It is shared across HMR/module reloads within one Next.js worker but NOT
// across workers or instances — a session registered in worker A is invisible
// to worker B. Deployments with >1 worker need sticky routing or a shared
// store; multi-worker support is explicitly OUT OF SCOPE here.
//
// One entry is one open stream: dropping an entry always closes its stream, so
// the session caps below count open streams.

import { v4 as uuidv4 } from "uuid";

const KEY = "__9routerGatewaySse";
const SESSION_TTL_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
export const MAX_SESSIONS_PER_KEY = 5;
export const MAX_SESSIONS_TOTAL = 100;

/** @type {ReturnType<typeof setInterval> | null} lazily started sweeper */
let sweepTimer = null;
/** @type {ReturnType<typeof setInterval> | null} started with the sweeper */
let heartbeatTimer = null;

function getStore() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = new Map();
  }
  return globalThis[KEY];
}

/**
 * Drop and close sessions idle longer than SESSION_TTL_MS: no getSession call
 * and no accepted heartbeat since lastSeenAt. Runs on the unref'd sweep timer.
 */
function sweep() {
  const now = Date.now();
  for (const [sid, entry] of getStore()) {
    if (now - entry.lastSeenAt > SESSION_TTL_MS) unregisterSession(sid);
  }
}

/** Ping every stream; one that accepts the write is alive and stays fresh. */
function beat() {
  const now = Date.now();
  for (const entry of getStore().values()) {
    if (entry.heartbeat?.()) entry.lastSeenAt = now;
  }
}

/**
 * Start the sweep and heartbeat intervals on first session registration.
 * Unref'd so they never keep the process alive; later registrations reuse them.
 */
function ensureTimers() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

/**
 * Register an outbound send callback for a new SSE session.
 * @param {(chunk: string) => void} sendFn
 * @param {string} keyId gateway key the session is bound to
 * @param {object} [stream]
 * @param {() => void} [stream.close] closes the stream when the entry is dropped
 * @param {() => boolean} [stream.heartbeat] writes a ping; false when not writable
 * @param {string|null} [stream.queryKey] raw key, set only for `?key=` handshakes
 * @returns {string|null} session id, or null when a cap is reached
 */
export function registerSession(sendFn, keyId, { close, heartbeat, queryKey = null } = {}) {
  const store = getStore();
  if (store.size >= MAX_SESSIONS_TOTAL) return null;
  let keySessions = 0;
  for (const entry of store.values()) if (entry.keyId === keyId) keySessions++;
  if (keySessions >= MAX_SESSIONS_PER_KEY) return null;
  ensureTimers();
  const sid = uuidv4();
  const now = Date.now();
  store.set(sid, { send: sendFn, close, heartbeat, queryKey, keyId, createdAt: now, lastSeenAt: now });
  return sid;
}

/**
 * Unregister an SSE session and close its stream.
 * @param {string} sid
 */
export function unregisterSession(sid) {
  const store = getStore();
  const entry = store.get(sid);
  if (!entry) return;
  store.delete(sid);
  entry.close?.();
}

/**
 * Raw key of a session opened with `?key=`, so the message route can accept a
 * POST that carries only the session id. Does not refresh lastSeenAt: the
 * caller has not been authenticated yet.
 * @param {string} sid
 * @returns {string|null}
 */
export function getSessionQueryKey(sid) {
  return getStore().get(sid)?.queryKey ?? null;
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
  HEARTBEAT_INTERVAL_MS,
  stopSweeper() {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  },
};
