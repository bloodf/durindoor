/**
 * Shared TTL cache plus in-flight dedup for the live model-catalog modules.
 *
 * A loader answers with a catalog value, or `null` for a failed lookup. Values
 * are kept for `ttlMs`; `null` is remembered for `negativeTtlMs`. A loader that
 * throws is neither cached nor negatively cached. A TTL of 0 stores nothing, so
 * the instance only coalesces concurrent loads.
 */

/**
 * @param {object} [config]
 * @param {number} [config.ttlMs] Lifetime of a loaded value.
 * @param {number} [config.negativeTtlMs] Lifetime of a remembered failure.
 * @param {(...args: any[]) => any} [config.keyFn] Builds a cache key, exposed as `keyFor`.
 * @param {number} [config.maxEntries] Oldest entry is dropped at this size.
 */
export function createCatalogCache({
  ttlMs = 0,
  negativeTtlMs = 0,
  keyFn = (key) => key,
  maxEntries = Infinity
} = {}) {
  const entries = new Map();
  const negatives = new Map();
  const inflight = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > Date.now()) return entry.value;
    entries.delete(key);
    return undefined;
  }

  function set(key, value, from = Date.now()) {
    negatives.delete(key);
    if (ttlMs <= 0) return;
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    entries.set(key, { value, expiresAt: from + ttlMs });
  }

  /**
   * Return the cached value, join the running load, or run `loader`.
   *
   * @param {any} key Cache key.
   * @param {() => Promise<any>} loader
   * @param {object} [options]
   * @param {boolean} [options.force] Skip both caches and the running load.
   * @param {any} [options.flightKey] Which concurrent callers may share one load.
   *   `null` keeps this load private, for example when the caller can abort it.
   * @param {boolean} [options.ageFromStart] Count TTLs from the start of the load.
   */
  async function load(key, loader, { force = false, flightKey = key, ageFromStart = false } = {}) {
    if (!force) {
      const value = get(key);
      if (value !== undefined) return value;
      if (negatives.get(key) > Date.now()) return null;
      if (flightKey !== null && inflight.has(flightKey)) return inflight.get(flightKey);
    }

    const startedAt = Date.now();
    const request = (async () => {
      const value = await loader();
      const from = ageFromStart ? startedAt : Date.now();
      if (value !== null) set(key, value, from);
      else if (negativeTtlMs > 0) negatives.set(key, from + negativeTtlMs);
      return value;
    })();

    if (flightKey === null) return request;
    inflight.set(flightKey, request);
    try {
      return await request;
    } finally {
      // A forced load that started later may have replaced this entry.
      if (inflight.get(flightKey) === request) inflight.delete(flightKey);
    }
  }

  return {
    keyFor: keyFn,
    get,
    set,
    load,
    delete(key) {
      entries.delete(key);
      negatives.delete(key);
    },
    clear() {
      entries.clear();
      negatives.clear();
      inflight.clear();
    }
  };
}
