// The one Gemini thoughtSignature store (upstream decolua/9router@c08efdbe).
//
// In-memory LRU Map (cap 2000, 1h TTL) in front of the shared SQLite `kv`
// table (scope "gemini_thought_signatures"). All SQLite access is fail-open.
//
// Key scheme: `<scope>:<toolCallId>` plus a bare `<toolCallId>` alias, so replay
// works when the scope is unknown or changes. Two kinds of caller share it:
// - session API (openai→gemini / antigravity): scope is the client session id,
//   persisted 7d; the alias is readable by anyone.
// - keyed API (direct claude↔gemini, re-exported by
//   geminiThoughtSignatureStore.js): scope is the connection id, persisted 30d;
//   the alias records its `owner`, so another connection's keyed read skips it.
//
// One prune cap covers both. An alias names its `primary` row, is not counted
// against the cap, and is evicted together with that row.
//
// Account provenance: an Antigravity capture with a known selected account also
// records `account` on its rows. Such rows are readable only by the
// account-aware reader (`getProvenThoughtSignature`), never by another account,
// another session, or the session/keyed bare-id fallback.
//
// Legacy rows: both old key shapes are still read. A connection-keyed row without
// `createdAt` is rewritten with its alias on first keyed read; until then the
// session API cannot find it by bare id.
import { getAdapter, getAdapterSync } from "../../src/lib/db/driver.js";
import { parseJson, stringifyJson } from "../../src/lib/db/helpers/jsonCol.js";
import { makeKv } from "../../src/lib/db/helpers/kvStore.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const MAX_SIGNATURES = 2000;
const MAX_PERSISTED_SIGNATURES = 10_000;
const MEMORY_TTL_MS = 1000 * 60 * 60; // 1 hour
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const KEYED_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const KEYED_FAMILY = "gemini"; // the keyed API only serves the direct Gemini route
const SCOPE = "gemini_thought_signatures";
const UPSERT = "INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value";

const signatureKv = makeKv(SCOPE);
const memorySignatures = new Map();
let writesSincePrune = 0;

/**
 * Model family that produced / will consume a signature. Antigravity serves Gemini and Claude
 * models behind the same API, and each backend only accepts its own signatures: a Claude
 * signature replayed to Gemini fails with 400 "Corrupted thought signature." (and vice versa).
 */
export function signatureFamily(model) {
  const m = isString(model) ? model.toLowerCase() : "";
  if (!m) return null;
  if (m.includes("claude")) return "claude";
  if (m.includes("gemini")) return "gemini";
  return m;
}

// Entries stored before families were recorded (no `family`) stay usable for any model.
function isCompatible(entry, family) {
  return !entry.family || !family || entry.family === family;
}

function pruneMemoryExpired() {
  const now = Date.now();
  for (const [key, value] of memorySignatures.entries()) {
    if (value.expiresAt <= now) {
      memorySignatures.delete(key);
    }
  }

  while (memorySignatures.size > MAX_SIGNATURES) {
    memorySignatures.delete(memorySignatures.keys().next().value);
  }
}

function remember(key, value) {
  memorySignatures.delete(key);
  memorySignatures.set(key, {
    signature: value.signature,
    family: value.family || null,
    owner: value.owner || null,
    account: value.account || null,
    expiresAt: Math.min(value.expiresAt || Infinity, Date.now() + MEMORY_TTL_MS),
  });
}

// RAM lookup that refreshes the LRU position of a hit.
function recall(key) {
  const entry = memorySignatures.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  memorySignatures.delete(key);
  memorySignatures.set(key, entry);
  return entry;
}

// Persisted rows without `expiresAt` never expire.
function liveEntry(entry, now = Date.now()) {
  return entry && isString(entry.signature) && entry.signature && (!entry.expiresAt || entry.expiresAt > now) ? entry : null;
}

// Legacy connection-keyed rows have no `createdAt`; derive it from their TTL.
function writtenAt(entry) {
  return entry.createdAt || (entry.expiresAt ? entry.expiresAt - KEYED_TTL_MS : 0);
}

function dbOrNull() {
  try {return getAdapterSync();} catch {return null;}
}

function removeRow(db, key) {
  db.run("DELETE FROM kv WHERE scope = ? AND key = ?", [SCOPE, key]);
}

// Synchronous persisted read; drops dead rows.
function readRow(db, key) {
  const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [SCOPE, key]);
  if (!row) return null;
  const entry = liveEntry(parseJson(row.value, null));
  if (!entry) removeRow(db, key);
  return entry;
}

/** Drop dead rows, then the oldest signatures beyond `cap`. */
export function prunePersistedNow(db, now = Date.now(), cap = MAX_PERSISTED_SIGNATURES) {
  try {
    const live = new Map();
    for (const row of db.all("SELECT key, value FROM kv WHERE scope = ?", [SCOPE])) {
      const entry = liveEntry(parseJson(row.value, null), now);
      if (entry) live.set(row.key, entry);else
      removeRow(db, row.key);
    }
    const primaries = [...live].filter(([, entry]) => !live.has(entry.primary));
    primaries.sort(([, a], [, b]) => writtenAt(a) - writtenAt(b) || (a.expiresAt || 0) - (b.expiresAt || 0));
    const evicted = new Set(primaries.slice(0, Math.max(0, primaries.length - cap)).map(([key]) => key));
    for (const [key, entry] of live) {
      if (evicted.has(key) || evicted.has(entry.primary)) removeRow(db, key);
    }
  } catch {/* persistence is best-effort */}
}

/** Prune once every 100 writes. */
export function prunePersisted(db, now = Date.now(), cap = MAX_PERSISTED_SIGNATURES) {
  if (++writesSincePrune < 100) return;
  writesSincePrune = 0;
  prunePersistedNow(db, now, cap);
}

export function pruneForTests(cap) {
  const db = dbOrNull();
  if (db) prunePersistedNow(db, Date.now(), cap);
}

export function scopedSignatureKey(scope, toolCallId) {
  return isString(scope) && scope && isString(toolCallId) && toolCallId ? `${scope}:${toolCallId}` : null;
}

// The only writer: synchronous once the adapter is open, otherwise async.
// `alias: false` writes only the scoped row, so no other scope can read it by bare id.
function writeSignature(toolCallId, signature, { scope = null, owner = null, account = null, family = null, expiresAt, now, alias = true }) {
  const value = { signature, family, createdAt: now, expiresAt, ...(account && { account }) };
  const primary = scopedSignatureKey(scope, toolCallId);
  const rows = primary ?
  alias ? [[primary, value], [toolCallId, { ...value, primary, ...(owner && { owner }) }]] : [[primary, value]] :
  [[toolCallId, value]];

  for (const [key, row] of rows) remember(key, row);
  pruneMemoryExpired();

  const db = dbOrNull();
  if (!db) {
    for (const [key, row] of rows) persistLater(key, row);
    return;
  }
  for (const [key, row] of rows) {
    try {
      db.run(UPSERT, [SCOPE, key, stringifyJson(row)]);
      unpersisted.delete(key);
    } catch {
      // An existing row may be an older capture, even with the same signature.
      // Retain the complete replacement (provenance and original expiry too).
      persistLater(key, row, false);
    }
  }
  prunePersisted(db, now);
}

// Write-behind rows not yet confirmed in SQLite, by key. A capture made before
// this process opened the adapter is persisted asynchronously, and that open can
// fail transiently (another process migrating the same file reports "database is
// locked"; the next getAdapter() retries the open). A row stays here until a
// write succeeds, so a persisted (cold) read awaits the in-flight write, retries
// a failed one, and never misses the capture (#2034). Bounded like the RAM cache.
const unpersisted = new Map();

function persistLater(key, row, writeNow = true) {
  const entry = { row, write: null };
  unpersisted.delete(key);
  unpersisted.set(key, entry);
  while (unpersisted.size > MAX_SIGNATURES) unpersisted.delete(unpersisted.keys().next().value);
  if (writeNow) entry.write = persistEntry(key, entry);
}

async function persistEntry(key, entry) {
  try {
    const db = await getAdapter();
    // Opening can yield to a newer capture, successful sync write, or clear.
    // Check after that boundary so a superseded write cannot overwrite it.
    if (unpersisted.get(key) !== entry) return;
    db.run(UPSERT, [SCOPE, key, stringifyJson(entry.row)]);
    if (unpersisted.get(key) === entry) unpersisted.delete(key);
  } catch {/* kept for the next persisted read */}
}

// The persisted boundary of every async read: settle the key's pending write
// (retrying it once if it failed) before querying SQLite. A row SQLite still
// cannot take is returned as written, so provenance and expiry checks apply to
// it exactly as to a persisted row.
async function readPersisted(key) {
  let entry = unpersisted.get(key);
  if (entry) {
    await entry.write;
    entry = unpersisted.get(key);
    if (entry) {
      entry.write = persistEntry(key, entry);
      await entry.write;
    }
    // A newer capture may have replaced the entry during either await. Return
    // that complete row if still pending; never fall back to an older DB row.
    entry = unpersisted.get(key);
    if (entry) {
      if (liveEntry(entry.row)) return entry.row;
      // Keep expired replacements pending too: dropping them could resurrect
      // an older, longer-lived SQLite row after another failed write.
      return null;
    }
  }
  const db = await getAdapter();
  // A capture can also arrive while the read itself is opening the adapter.
  const pending = unpersisted.get(key);
  return pending ? liveEntry(pending.row) : readRow(db, key);
}

// A usable selected-account id, or null ("unknown" is the gateway's placeholder).
function knownAccount(accountId) {
  return isString(accountId) && accountId && accountId !== "unknown" ? accountId : null;
}

// Rows bound to an account are not part of the shared bare-id fallback.
const accountBound = (entry) => Boolean(entry?.account);

/**
 * Store a thought signature for a tool_call_id with optional sessionId namespace (RAM + SQLite).
 * `model` is the model that produced the signature; lookups for another model family skip it.
 * `accountId` (Antigravity capture) binds both rows to the selected account: only
 * `getProvenThoughtSignature` for that account can read them.
 */
export function storeGeminiThoughtSignature(toolCallId, signature, sessionId = null, model = null, accountId = null) {
  if (!isString(toolCallId) || !toolCallId) return;
  if (!isString(signature) || !signature) return;

  const now = Date.now();
  writeSignature(toolCallId, signature, { scope: sessionId, account: knownAccount(accountId), family: signatureFamily(model), expiresAt: now + SESSION_TTL_MS, now });
}

/**
 * Retrieve a thought signature by tool_call_id (RAM first, then SQLite fallback).
 * `model` is the target model; signatures produced by another model family are ignored.
 */
export async function getGeminiThoughtSignature(toolCallId, sessionId = null, model = null) {
  const cached = getGeminiThoughtSignatureSync(toolCallId, sessionId, model);
  if (cached) return cached;
  if (!isString(toolCallId) || !toolCallId) return null;

  const family = signatureFamily(model);
  try {
    for (const key of [scopedSignatureKey(sessionId, toolCallId), toolCallId]) {
      if (!key) continue;
      const row = await readPersisted(key);
      if (!row) continue;
      if (!liveEntry(row)) {
        signatureKv.remove(key).catch(() => {});
      } else if (isCompatible(row, family) && !accountBound(row)) {
        remember(key, row);
        return row.signature;
      }
    }
  } catch {
    // Fail-open
  }

  return null;
}

/**
 * Synchronous get from RAM cache only (for sync translators).
 * `model` is the target model; signatures produced by another model family are ignored.
 */
export function getGeminiThoughtSignatureSync(toolCallId, sessionId = null, model = null) {
  if (!isString(toolCallId) || !toolCallId) return null;
  const family = signatureFamily(model);
  pruneMemoryExpired();

  for (const key of [scopedSignatureKey(sessionId, toolCallId), toolCallId]) {
    const entry = key && recall(key);
    if (entry && isCompatible(entry, family) && !accountBound(entry)) return entry.signature;
  }
  return null;
}

/**
 * Account + model-family scope for signatures captured from a selected account's
 * response (OmniRoute PR 21439 nonstream capture). Null when the account or the
 * family is unknown: such signatures are never written to a shared bare-id row.
 */
export function accountSignatureScope(accountId, model) {
  const family = signatureFamily(model);
  if (!isString(accountId) || !accountId || accountId === "unknown" || !family) return null;
  return `account.${accountId}.${family}`;
}

/** Account-scoped write without the bare alias; a no-op for an unknown account or family. */
export function storeAccountThoughtSignature(toolCallId, signature, accountId, model) {
  const scope = accountSignatureScope(accountId, model);
  if (!scope || !isString(toolCallId) || !toolCallId || !isString(signature) || !signature) return false;
  const now = Date.now();
  writeSignature(toolCallId, signature, { scope, family: signatureFamily(model), expiresAt: now + SESSION_TTL_MS, now, alias: false });
  return true;
}

/** Account-scoped RAM read: only the exact account + family row, never a bare alias. */
export function getAccountThoughtSignatureSync(toolCallId, accountId, model) {
  const key = scopedSignatureKey(accountSignatureScope(accountId, model), toolCallId);
  if (!key) return null;
  pruneMemoryExpired();
  return recall(key)?.signature || null;
}

/** Account-scoped read with SQLite fallback for a cold RAM cache. */
export async function getAccountThoughtSignature(toolCallId, accountId, model) {
  const cached = getAccountThoughtSignatureSync(toolCallId, accountId, model);
  if (cached) return cached;
  const key = scopedSignatureKey(accountSignatureScope(accountId, model), toolCallId);
  if (!key) return null;
  try {
    const row = await readPersisted(key);
    if (!row) return null;
    if (!liveEntry(row)) {
      signatureKv.remove(key).catch(() => {});
      return null;
    }
    remember(key, row);
    return row.signature;
  } catch {
    return null;
  }
}

// Candidate keys for a selected account's replay, each with its provenance rule:
// 1. the account + family row (nonstream capture, OmniRoute PR 21439);
// 2. the exact client-session row, unless another account captured it;
// 3. the bare alias, only when it records this same account.
// A bare row without recorded provenance (legacy, sessionless or another
// provider's capture) is never borrowed.
function provenCandidates(toolCallId, accountId, sessionId, model) {
  if (!isString(toolCallId) || !toolCallId) return [];
  const account = knownAccount(accountId);
  const family = signatureFamily(model);
  const candidates = [];
  const accountKey = scopedSignatureKey(accountSignatureScope(account, model), toolCallId);
  if (accountKey) candidates.push([accountKey, () => true]);
  const sessionKey = scopedSignatureKey(sessionId, toolCallId);
  if (sessionKey) candidates.push([sessionKey, (entry) => isCompatible(entry, family) && (!entry.account || entry.account === account)]);
  if (account) candidates.push([toolCallId, (entry) => isCompatible(entry, family) && entry.account === account]);
  return candidates;
}

/** Provenance-checked RAM read for a selected account (Antigravity executor). */
export function getProvenThoughtSignatureSync(toolCallId, { accountId = null, sessionId = null, model = null } = {}) {
  const candidates = provenCandidates(toolCallId, accountId, sessionId, model);
  if (candidates.length === 0) return null;
  pruneMemoryExpired();
  for (const [key, accepts] of candidates) {
    const entry = recall(key);
    if (entry && accepts(entry)) return entry.signature;
  }
  return null;
}

/** Provenance-checked read with SQLite fallback for a cold RAM cache. */
export async function getProvenThoughtSignature(toolCallId, scope = {}) {
  const cached = getProvenThoughtSignatureSync(toolCallId, scope);
  if (cached) return cached;
  const { accountId = null, sessionId = null, model = null } = scope;
  try {
    for (const [key, accepts] of provenCandidates(toolCallId, accountId, sessionId, model)) {
      const row = await readPersisted(key);
      if (!row) continue;
      if (!liveEntry(row)) {
        signatureKv.remove(key).catch(() => {});
      } else if (accepts(row)) {
        remember(key, row);
        return row.signature;
      }
    }
  } catch {/* fail-open */}
  return null;
}

// Connection ids carry no ":", tool call ids may, so split at the first one.
function splitKey(key) {
  const at = key.indexOf(":");
  return at > 0 && at < key.length - 1 ? { scope: key.slice(0, at), toolCallId: key.slice(at + 1) } : { scope: null, toolCallId: key };
}

/** Keyed write: `key` is `<connectionId>:<toolCallId>`. */
export function storeKeyedThoughtSignature(key, signature, expiresAt = Date.now() + KEYED_TTL_MS) {
  if (!isString(key) || !key || !isString(signature) || !signature || !Number.isFinite(expiresAt)) return;
  const { scope, toolCallId } = splitKey(key);
  writeSignature(toolCallId, signature, { scope, owner: scope, family: KEYED_FAMILY, expiresAt, now: Date.now() });
}

// Rewrite a legacy connection-keyed row in the current shape and add its alias.
function migrateKeyedRow(db, key, { scope, toolCallId }, legacy) {
  const value = { signature: legacy.signature, family: KEYED_FAMILY, createdAt: writtenAt(legacy), expiresAt: legacy.expiresAt };
  db.run(UPSERT, [SCOPE, key, stringifyJson(value)]);
  if (!readRow(db, toolCallId)) {
    const alias = { ...value, primary: key, owner: scope };
    db.run(UPSERT, [SCOPE, toolCallId, stringifyJson(alias)]);
    remember(toolCallId, alias);
  }
  return value;
}

/**
 * Keyed synchronous read (RAM, then SQLite): the exact key first, then the bare
 * alias unless another connection owns it.
 */
export function getKeyedThoughtSignature(key) {
  if (!isString(key) || !key) return null;
  pruneMemoryExpired();
  const parts = splitKey(key);
  const db = dbOrNull();

  for (const candidate of parts.scope ? [key, parts.toolCallId] : [key]) {
    const exact = candidate === key;
    const usable = (entry) => entry && isCompatible(entry, KEYED_FAMILY) && (exact || !entry.owner || entry.owner === parts.scope) &&
    (!accountBound(entry) || entry.account === parts.scope);
    const cached = recall(candidate);
    if (usable(cached)) return cached.signature;
    if (!db) continue;
    try {
      let row = unpersisted.has(candidate) ? liveEntry(unpersisted.get(candidate).row) : readRow(db, candidate);
      if (!usable(row)) continue;
      if (exact && parts.scope && !row.createdAt) {
        // A failed rewrite must not hide a readable signature.
        try {row = migrateKeyedRow(db, key, parts, row);} catch {/* next read retries */}
      }
      remember(candidate, row);
      return row.signature;
    } catch {/* fail-open */}
  }
  return null;
}

export async function clearThoughtSignatures() {
  memorySignatures.clear();
  unpersisted.clear();
  writesSincePrune = 0;
  try {await (await getAdapter()).run("DELETE FROM kv WHERE scope = ?", [SCOPE]);} catch {/* test cleanup without DB remains valid */}
}
export function clearThoughtSignatureMemory() {memorySignatures.clear();}
export function getThoughtSignatureMemorySize() {pruneMemoryExpired();return memorySignatures.size;}
