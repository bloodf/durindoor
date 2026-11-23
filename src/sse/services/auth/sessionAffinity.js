import { createHash } from "node:crypto";
import { MEMORY_CONFIG } from "open-sse/config/runtimeConfig.js";
import { isString } from "@/shared/utils/typeChecks.js";

const sessionAffinityState = new Map();
const MAX_SESSION_AFFINITIES = 5000;
export function normalizeSessionAffinityId(value) {
  if (!isString(value)) return null;
  const v = value.trim();
  return !v || v.length > 256 ? null : v;
}
function sessionAffinityKey(providerId, sessionId) { return `${providerId}:${sessionId}`; }
export function rememberSessionAffinity(providerId, sessionId, connectionId) {
  if (!providerId || !sessionId || !connectionId) return;
  if (sessionAffinityState.size >= MAX_SESSION_AFFINITIES) sessionAffinityState.delete(sessionAffinityState.keys().next().value);
  sessionAffinityState.set(sessionAffinityKey(providerId, sessionId), { connectionId, lastUsed: Date.now() });
}
export function getSessionAffinity(providerId, sessionId) {
  if (!providerId || !sessionId) return null;
  const entry = sessionAffinityState.get(sessionAffinityKey(providerId, sessionId));
  if (entry) entry.lastUsed = Date.now();
  return entry?.connectionId || null;
}
export function resetProviderSessionAffinity() { sessionAffinityState.clear(); }
export function pickByCacheAffinity(key, connections) {
  let best = null;
  let bestScore = "";
  for (const c of connections) {
    const score = createHash("sha256").update(`${key}\0${c.id}`).digest("hex");
    if (!best || score > bestScore || (score === bestScore && String(c.id) < String(best.id))) { best = c; bestScore = score; }
  }
  return best;
}
const affinityCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessionAffinityState) if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) sessionAffinityState.delete(key);
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (affinityCleanup.unref) affinityCleanup.unref();
