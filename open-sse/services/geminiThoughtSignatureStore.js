import { getAdapter, getAdapterSync } from "../../src/lib/db/driver.js";
import { parseJson, stringifyJson } from "../../src/lib/db/helpers/jsonCol.js";

const NAMESPACE = "gemini_thought_signatures";
const MAX_SIGNATURES = 1000;
const MEMORY_TTL_MS = 60 * 60 * 1000;
const PERSISTED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const signatures = new Map();
let signatureCacheMode = "enabled";
let writesSincePrune = 0;

function dbOrNull() {
  try { return getAdapterSync(); } catch { return null; }
}

function pruneMemory(now = Date.now()) {
  for (const [key, entry] of signatures) {
    if (entry.expiresAt <= now) signatures.delete(key);
  }
  while (signatures.size > MAX_SIGNATURES) signatures.delete(signatures.keys().next().value);
}

function persistedEntry(value, now = Date.now()) {
  const parsed = parseJson(value, null);
  return parsed && typeof parsed.signature === "string" && parsed.signature && Number.isFinite(parsed.expiresAt) && parsed.expiresAt > now ? parsed : null;
}

function remember(key, value, now = Date.now()) {
  signatures.delete(key);
  signatures.set(key, { signature: value.signature, expiresAt: Math.min(value.expiresAt, now + MEMORY_TTL_MS) });
  pruneMemory(now);
}

export function prunePersistedNow(db, now = Date.now(), cap = MAX_SIGNATURES) {
  try {
    const rows = db.all("SELECT key, value FROM kv WHERE scope = ?", [NAMESPACE]);
    const live = [];
    for (const row of rows) {
      const value = persistedEntry(row.value, now);
      if (!value) db.run("DELETE FROM kv WHERE scope = ? AND key = ?", [NAMESPACE, row.key]);
      else live.push({ key: row.key, expiresAt: value.expiresAt });
    }
    live.sort((a, b) => a.expiresAt - b.expiresAt);
    if (live.length > cap) for (const row of live.slice(0, live.length - cap)) db.run("DELETE FROM kv WHERE scope = ? AND key = ?", [NAMESPACE, row.key]);
  } catch { /* persistence is best-effort */ }
}
export function prunePersisted(db, now = Date.now(), cap = MAX_SIGNATURES) {
  if (++writesSincePrune < 100) return;
  writesSincePrune = 0;
  prunePersistedNow(db, now, cap);
}
export function _pruneForTests(cap) { const db = dbOrNull(); if (db) prunePersistedNow(db, Date.now(), cap); }

export function buildGeminiThoughtSignatureKey(namespace, toolCallId) {
  return typeof namespace === "string" && namespace && typeof toolCallId === "string" && toolCallId ? `${namespace}:${toolCallId}` : null;
}

export function storeGeminiThoughtSignature(key, signature, expiresAt = Date.now() + PERSISTED_TTL_MS) {
  if (typeof key !== "string" || !key || typeof signature !== "string" || !signature || !Number.isFinite(expiresAt)) return;
  const now = Date.now();
  const value = { signature, expiresAt };
  remember(key, value, now);
  const db = dbOrNull();
  if (!db) return;
  try {
    db.run("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value", [NAMESPACE, key, stringifyJson(value)]);
    prunePersisted(db, now);
  } catch { /* response translation must not fail when persistence does */ }
}

export function getGeminiThoughtSignature(key) {
  if (typeof key !== "string" || !key) return null;
  const now = Date.now();
  pruneMemory(now);
  const cached = signatures.get(key);
  if (cached) {
    signatures.delete(key);
    signatures.set(key, cached);
    return cached.signature;
  }
  const db = dbOrNull();
  if (!db) return null;
  try {
    const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [NAMESPACE, key]);
    if (!row) return null;
    const value = persistedEntry(row.value, now);
    if (!value) {
      db.run("DELETE FROM kv WHERE scope = ? AND key = ?", [NAMESPACE, key]);
      return null;
    }
    remember(key, value, now);
    return value.signature;
  } catch { return null; }
}

export function resolveGeminiThoughtSignature(key, clientSignature) {
  return typeof clientSignature === "string" && clientSignature ? clientSignature : getGeminiThoughtSignature(key);
}

export function normalizeSignatureCacheMode(value) {
  return value === "bypass" || value === "bypass-strict" ? value : "enabled";
}
export function setGeminiThoughtSignatureMode(mode) { signatureCacheMode = normalizeSignatureCacheMode(mode); }
export function getGeminiThoughtSignatureMode() { return signatureCacheMode; }
export function isValidBasicGeminiThoughtSignature(signature) { return typeof signature === "string" && /^[RE][A-Za-z0-9+/]+={0,2}$/.test(signature); }
export function isValidFullGeminiThoughtSignature(signature) { return isValidBasicGeminiThoughtSignature(signature); }

export async function clearGeminiThoughtSignatures() {
  signatures.clear();
  signatureCacheMode = "enabled";
  writesSincePrune = 0;
  try { await (await getAdapter()).run("DELETE FROM kv WHERE scope = ?", [NAMESPACE]); } catch { /* test cleanup without DB remains valid */ }
}
export function clearGeminiThoughtSignatureMemoryForTests() { signatures.clear(); }
export function getGeminiThoughtSignatureMemorySizeForTests() { pruneMemory(); return signatures.size; }
