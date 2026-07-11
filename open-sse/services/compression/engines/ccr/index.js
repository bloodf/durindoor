/**
 * CCR content store — minimal local slice backing session-dedup's fuzzy pass.
 *
 * Ported verbatim from omniroute/main open-sse/services/compression/engines/ccr/index.ts
 * (the bounded principal-scoped block store, lines ~63-122). This file exposes ONLY
 * `storeBlock` (+ `resetCcrStore` for test isolation); it does NOT register or expose the
 * CCR engine. Full CCR retrieve/feedback semantics live out of F-1a scope.
 *
 * Contract preserved:
 *  - content hash = SHA-256 first 24 hex chars
 *  - store key = `${principalId ?? "__anon__"} ${hash}` (principal-scoped, IDOR-safe)
 *  - bounded 5 000-entry FIFO Map (insertion-order eviction)
 *  - dedup store of an existing key does NOT refresh insertion order
 */

import crypto from "node:crypto";

export const MAX_CCR_ENTRIES = 5_000;

const ccrStore = new Map();
const ANON = "__anon__";

function buildStoreKey(hash, principalId) {
  return `${principalId ?? ANON} ${hash}`;
}

/** Insert with FIFO eviction once over the cap; existing keys are NOT refreshed. */
function boundedSet(map, key, value) {
  if (!map.has(key) && map.size >= MAX_CCR_ENTRIES) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) {
      map.delete(firstKey);
    }
  }
  map.set(key, value);
}

function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
}

/**
 * Store a block under the given principal; returns the 24-hex content hash.
 * Re-storing an identical (principal, hash) pair is a no-op (no eviction-order refresh).
 */
export function storeBlock(text, principalId) {
  const hash = hashContent(text);
  const key = buildStoreKey(hash, principalId);
  if (!ccrStore.has(key)) {
    boundedSet(ccrStore, key, text);
  }
  return hash;
}

/** Reset the store (test isolation only). */
export function resetCcrStore() {
  ccrStore.clear();
}
