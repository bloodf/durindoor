/**
 * Round-robin conversation affinity (#2266, #6733).
 *
 * Sticky round-robin keeps one conversation on the same first model so provider
 * prompt caches keep hitting. Pins live in process-local state (runtimeState.js).
 *
 * Bounds: each caller scope (API key id, or the shared local scope) holds at most
 * MAX_CONVERSATION_AFFINITY_ENTRIES pins. Every scope keeps an insertion-ordered
 * index refreshed on use, so its oldest pin is always first. An insert trims
 * expired pins from the front of its own scope, then evicts the oldest pin when
 * the scope is full. Both steps stop at the first live entry, so a sticky request
 * never walks the whole map. Lookups ignore and drop expired pins.
 */

import { getComboRuntimeState } from "./runtimeState.js";

export const CONVERSATION_AFFINITY_TTL_MS = 60 * 60 * 1000;
export const MAX_CONVERSATION_AFFINITY_ENTRIES = 1000;

const state = getComboRuntimeState();
/** @type {Map<string, { index: number, lastUsed: number, scope?: string|null }>} */
export const comboConversationAffinity = state.affinity;
const scopes = state.affinityScopes;

/** Each caller has its own LRU budget; local callers share the legacy scope. */
export function affinityKeyFor(rotationKey, conversationKey, apiKeyId) {
  return apiKeyId ? `${rotationKey}:${conversationKey}:key:${JSON.stringify(apiKeyId)}` : `${rotationKey}:${conversationKey}`;
}

function isExpired(entry, now) {
  return !entry || now - entry.lastUsed > CONVERSATION_AFFINITY_TTL_MS;
}

export function deleteConversationAffinity(key) {
  const entry = comboConversationAffinity.get(key);
  if (entry) {
    const scope = entry.scope || null;
    const index = scopes.get(scope);
    if (index) {
      index.delete(key);
      if (index.size === 0) scopes.delete(scope);
    }
  }
  comboConversationAffinity.delete(key);
}

// Drop expired pins from the oldest end of one scope, then the oldest live pin
// while the scope is at its cap. Work is proportional to entries removed.
function trimScope(scope, now, limit) {
  const index = scopes.get(scope);
  if (!index) return;
  for (const key of index) {
    const entry = comboConversationAffinity.get(key);
    const stale = !entry || (entry.scope || null) !== scope;
    if (stale) {
      index.delete(key);
      continue;
    }
    if (isExpired(entry, now) || index.size >= limit) {
      deleteConversationAffinity(key);
      continue;
    }
    break;
  }
  if (index.size === 0) scopes.delete(scope);
}

export function setConversationAffinity(key, entry, now = entry.lastUsed) {
  deleteConversationAffinity(key);
  const scope = entry.scope || null;
  trimScope(scope, now, MAX_CONVERSATION_AFFINITY_ENTRIES);
  let index = scopes.get(scope);
  if (!index) scopes.set(scope, index = new Set());
  index.add(key);
  comboConversationAffinity.set(key, entry);
}

/**
 * Return a live pin or null. An expired pin is removed on sight.
 */
export function getConversationAffinity(key, now = Date.now()) {
  const entry = comboConversationAffinity.get(key);
  if (!entry) return null;
  if (isExpired(entry, now)) {
    deleteConversationAffinity(key);
    return null;
  }
  return entry;
}

/** Remove every pin of one combo, or all pins. Called on config resets only. */
export function resetConversationAffinity(comboName) {
  if (!comboName) {
    comboConversationAffinity.clear();
    scopes.clear();
    return;
  }
  const prefix = `${comboName}:`;
  for (const key of [...comboConversationAffinity.keys()]) {
    if (key.startsWith(prefix)) deleteConversationAffinity(key);
  }
}

/**
 * Build the per-request release hook for #6733. A pin is released only when the
 * pinned first member (attempt 0) fails and the stored index still points at the
 * failed model, so a concurrent re-pin to another member survives. Idempotent.
 */
export function createAffinityRelease({ strategy, stickyLimit, comboName, conversationCacheKey, apiKeyId, activeModels }) {
  const key = strategy === "round-robin" && stickyLimit > 1 && conversationCacheKey ?
    affinityKeyFor(comboName || "__default__", conversationCacheKey, apiKeyId) :
    null;
  let released = false;
  return (failedModelStr, attemptIndex) => {
    if (released || !key) return;
    if (attemptIndex !== 0) return;
    const pinned = comboConversationAffinity.get(key);
    if (pinned && activeModels[pinned.index % activeModels.length] === failedModelStr) {
      deleteConversationAffinity(key);
    }
    released = true;
  };
}
