/**
 * Short-lived, one-use pairing for browser-extension cookie import.
 *
 * The dashboard (an authenticated operator) issues a pairing bound to one
 * provider, that operator and one target: an existing connection or an explicit
 * create. The extension presents the secret exactly once to the import route.
 * Only a SHA-256 digest is kept in memory, and `consumePairing` removes the
 * entry in the same synchronous step that reads it, so concurrent presentations
 * of one secret cannot both succeed. State is per process, like the web-login
 * session store.
 */

import { createHash, randomBytes } from "node:crypto";
import { isString } from "@/shared/utils/typeChecks";

export const PAIRING_TTL_MS = 2 * 60 * 1000;
export const MAX_PENDING_PER_OWNER = 3;
export const MAX_PENDING_TOTAL = 200;
export const PAIRING_TOKEN_PREFIX = "ddpair_";
const TOKEN_RE = /^ddpair_[A-Za-z0-9_-]{43}$/;
const STORE_KEY = Symbol.for("durindoor.cookieImportPairings");

function store() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = new Map();
  return globalThis[STORE_KEY];
}

const digest = (token) => createHash("sha256").update(token).digest("hex");

function sweep(now) {
  for (const [key, entry] of store()) if (entry.expiresAt <= now) store().delete(key);
}

export function isWellFormedPairingToken(token) {
  return isString(token) && TOKEN_RE.test(token);
}

/**
 * @param {{ provider: string, owner: string, target: { action: "create", name: string } | { action: "update", connectionId: string }, accountEmail?: string }} binding
 *   `accountEmail` (already validated) is kept only in this server-side entry: it is never returned
 *   to the client, and the import request cannot set or change it.
 * @returns {{ token: string, expiresAt: number } | null} null when the global pending cap is reached
 */
export function issuePairing({ provider, owner, target, accountEmail = "" }, now = Date.now()) {
  sweep(now);
  const mine = [...store()].filter(([, entry]) => entry.owner === owner);
  // A new pairing supersedes the oldest of the operator's pending ones.
  while (mine.length >= MAX_PENDING_PER_OWNER) store().delete(mine.shift()[0]);
  if (store().size >= MAX_PENDING_TOTAL) return null;
  const token = `${PAIRING_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = now + PAIRING_TTL_MS;
  store().set(digest(token), Object.freeze({ provider, owner, target: Object.freeze({ ...target }), accountEmail: isString(accountEmail) ? accountEmail : "", expiresAt }));
  return { token, expiresAt };
}

/**
 * Atomically take a pairing. Unknown, expired and already-used secrets are
 * indistinguishable to the caller.
 * @returns {{ provider: string, owner: string, target: object, accountEmail: string } | null}
 */
export function consumePairing(token, now = Date.now()) {
  if (!isWellFormedPairingToken(token)) return null;
  const key = digest(token);
  const entry = store().get(key);
  if (!entry) return null;
  store().delete(key);
  return entry.expiresAt > now ? entry : null;
}

/** Test and diagnostics helper; never exposes secrets. */
export function pendingPairingCount() {
  sweep(Date.now());
  return store().size;
}

export function clearPairings() {
  store().clear();
}
