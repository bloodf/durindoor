import { getAdapter, getAdapterSync } from "../../src/lib/db/driver.js";
import { parseJson, stringifyJson } from "../../src/lib/db/helpers/jsonCol.js";

const NAMESPACE = "gemini_thought_signatures";
const MAX_SIGNATURES = 1000;
const MEMORY_TTL_MS = 60 * 60 * 1000;
const PERSISTED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const signatures = new Map();
let signatureCacheMode = "enabled";

function prune() {
  const now = Date.now();
  for (const [key, entry] of signatures) if (entry.expiresAt <= now) signatures.delete(key);
  while (signatures.size > MAX_SIGNATURES) signatures.delete(signatures.keys().next().value);
}
function dbOrNull() { try { return getAdapterSync(); } catch { return null; } }
function entry(value) {
  const parsed = parseJson(value, null);
  return parsed && typeof parsed.signature === "string" && parsed.signature && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now() ? parsed : null;
}
function persist(key, value) {
  const db = dbOrNull();
  if (!db) return;
  try { db.run("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value", [NAMESPACE, key, stringifyJson(value)]); } catch { /* fail open */ }
}

export function buildGeminiThoughtSignatureKey(namespace, toolCallId) {
  return typeof namespace === "string" && namespace && typeof toolCallId === "string" && toolCallId ? `${namespace}:${toolCallId}` : toolCallId;
}
export function storeGeminiThoughtSignature(key, signature, expiresAt = Date.now() + PERSISTED_TTL_MS) {
  if (typeof key !== "string" || !key || typeof signature !== "string" || !signature) return;
  prune();
  const value = { signature, expiresAt };
  signatures.set(key, { signature, expiresAt: Math.min(expiresAt, Date.now() + MEMORY_TTL_MS) });
  persist(key, value);
}
export function getGeminiThoughtSignature(key) {
  if (typeof key !== "string" || !key) return null;
  prune();
  const cached = signatures.get(key);
  if (cached) return cached.signature;
  const db = dbOrNull();
  if (!db) return null;
  try {
    const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [NAMESPACE, key]);
    const value = entry(row?.value);
    if (!value) { if (row) db.run("DELETE FROM kv WHERE scope = ? AND key = ?", [NAMESPACE, key]); return null; }
    signatures.set(key, { signature: value.signature, expiresAt: Math.min(value.expiresAt, Date.now() + MEMORY_TTL_MS) });
    return value.signature;
  } catch { return null; }
}
export function resolveGeminiThoughtSignature(key, clientSignature) {
  if (typeof clientSignature === "string" && clientSignature) return clientSignature;
  return getGeminiThoughtSignature(key);
}
export function normalizeSignatureCacheMode(value) { return value === "bypass" || value === "bypass-strict" ? value : "enabled"; }
export function setGeminiThoughtSignatureMode(mode) { signatureCacheMode = normalizeSignatureCacheMode(mode); }
export function getGeminiThoughtSignatureMode() { return signatureCacheMode; }
export function isValidBasicGeminiThoughtSignature(signature) { return typeof signature === "string" && /^[RE][A-Za-z0-9+/]+={0,2}$/.test(signature); }
export function isValidFullGeminiThoughtSignature(signature) { return isValidBasicGeminiThoughtSignature(signature); }
export async function clearGeminiThoughtSignatures() { signatures.clear(); signatureCacheMode = "enabled"; const db = await getAdapter(); db.run("DELETE FROM kv WHERE scope = ?", [NAMESPACE]); }
export function clearGeminiThoughtSignatureMemoryForTests() { signatures.clear(); }
export function getGeminiThoughtSignatureMemorySizeForTests() { prune(); return signatures.size; }
