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
function writeSignature(toolCallId, signature, { scope = null, owner = null, family = null, expiresAt, now, alias = true }) {
  const value = { signature, family, createdAt: now, expiresAt };
  const primary = scopedSignatureKey(scope, toolCallId);
  const rows = primary ?
  alias ? [[primary, value], [toolCallId, { ...value, primary, ...(owner && { owner }) }]] : [[primary, value]] :
  [[toolCallId, value]];

  for (const [key, row] of rows) remember(key, row);
  pruneMemoryExpired();

  const db = dbOrNull();
  if (!db) {
    for (const [key, row] of rows) signatureKv.set(key, row).catch(() => {});
    return;
  }
  try {
    for (const [key, row] of rows) db.run(UPSERT, [SCOPE, key, stringifyJson(row)]);
    prunePersisted(db, now);
  } catch {/* response translation must not fail when persistence does */}
}

/**
 * Store a thought signature for a tool_call_id with optional sessionId namespace (RAM + SQLite).
 * `model` is the model that produced the signature; lookups for another model family skip it.
 */
export function storeGeminiThoughtSignature(toolCallId, signature, sessionId = null, model = null) {
  if (!isString(toolCallId) || !toolCallId) return;
  if (!isString(signature) || !signature) return;

  const now = Date.now();
  writeSignature(toolCallId, signature, { scope: sessionId, family: signatureFamily(model), expiresAt: now + SESSION_TTL_MS, now });
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
      const row = await signatureKv.get(key);
      if (!row) continue;
      if (!liveEntry(row)) {
        signatureKv.remove(key).catch(() => {});
      } else if (isCompatible(row, family)) {
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
    if (entry && isCompatible(entry, family)) return entry.signature;
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
    const row = await signatureKv.get(key);
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
    const usable = (entry) => entry && isCompatible(entry, KEYED_FAMILY) && (exact || !entry.owner || entry.owner === parts.scope);
    const cached = recall(candidate);
    if (usable(cached)) return cached.signature;
    if (!db) continue;
    try {
      let row = readRow(db, candidate);
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
  writesSincePrune = 0;
  try {await (await getAdapter()).run("DELETE FROM kv WHERE scope = ?", [SCOPE]);} catch {/* test cleanup without DB remains valid */}
}
export function clearThoughtSignatureMemory() {memorySignatures.clear();}
export function getThoughtSignatureMemorySize() {pruneMemoryExpired();return memorySignatures.size;}
