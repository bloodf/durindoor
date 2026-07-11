/**
 * Provider Health Monitor — short-TTL cached availability probes for the
 * user's configured provider connections.
 *
 * Port of OmniRoute's monitoring health service + PR #6553 (1s payload cache),
 * adapted to DurinDoor. Targets come from `getProviderConnections()` (the
 * connections the user actually configured — including custom OpenAI/Anthropic-
 * compatible endpoints), NOT the static registry, so custom compatible
 * providers are monitored and "no key configured yet" is not misreported as an
 * outage.
 *
 * Probes go through {@link probeConnectionHealth}: real network I/O,
 * SSRF-guarded (O-B #191), proxy-aware (saved connection proxy / proxy pool),
 * side-effect-free (no `testStatus` DB writes). Error strings are sanitized
 * before leaving the service.
 *
 * State mapping:
 *   - valid probe                 → healthy
 *   - 401/403 (reachable, bad key)→ degraded
 *   - 5xx / network fail / timeout→ down
 *   - SSRF-blocked URL            → blocked
 *   - no probe could be built     → unconfigured
 *
 * The aggregated payload is cached for {@link HEALTH_PAYLOAD_TTL_MS}; concurrent
 * misses share a single in-flight build (deduped via `pendingBuild`). The cache
 * is invalidated by {@link invalidateHealthCache}.
 *
 * `fetcher`/`now`/`connectionsLoader`/`prober` are injectable for tests.
 */
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { probeConnectionHealth, sanitizeErrorMessage, AUTH_FAILURE_STATUSES } from "@/lib/providerHealthProbe";

/** @typedef {"healthy"|"degraded"|"down"|"blocked"|"unconfigured"|"unknown"} HealthState */

/**
 * @typedef {Object} ProviderHealth
 * @property {string} id            connection id
 * @property {string} provider      provider id
 * @property {string} name          connection or provider display name
 * @property {HealthState} state
 * @property {number|null} latencyMs
 * @property {number|null} statusCode
 * @property {string|null} error    sanitized
 */

export const HEALTH_PAYLOAD_TTL_MS = 1000;

let payloadCache = /** @type {{ payload: object, expiresAt: number } | null} */ (null);
let pendingBuild = /** @type {Promise<object> | null} */ (null);
// Monotonic generation counter. invalidateHealthCache() bumps it so any build
// started before invalidation discards its result instead of repopulating the
// cache with stale data (probes themselves cannot be cancelled).
let buildGeneration = 0;

/** Drop the cached payload and detach any in-flight build so reads rebuild. */
export function invalidateHealthCache() {
  payloadCache = null;
  buildGeneration += 1;
  pendingBuild = null;
}

/** Test/diagnostic hook — current cache entry (or null). */
export function getHealthCacheEntry() {
  return payloadCache;
}

function mapResult(conn, result, latencyMs) {
  const name = conn.name || conn.provider;
  if (!result) {
    return { id: conn.id, provider: conn.provider, name, state: "unconfigured", latencyMs, statusCode: null, error: null };
  }
  if (result.blocked) {
    return {
      id: conn.id,
      provider: conn.provider,
      name,
      state: "blocked",
      latencyMs,
      statusCode: null,
      error: sanitizeErrorMessage(result.error || "blocked by SSRF guard"),
    };
  }
  if (result.unconfigured) {
    return {
      id: conn.id,
      provider: conn.provider,
      name,
      state: "unconfigured",
      latencyMs,
      statusCode: null,
      error: sanitizeErrorMessage(result.error || null),
    };
  }
  const status = result.status ?? null;
  let state = /** @type {HealthState} */ ("unknown");
  if (result.valid) state = "healthy";
  else if (status !== null && AUTH_FAILURE_STATUSES.has(status)) state = "degraded";
  else if (status !== null && status >= 500) state = "down";
  else if (status === null) state = "down";
  else state = "degraded";
  return {
    id: conn.id,
    provider: conn.provider,
    name,
    state,
    latencyMs,
    statusCode: status,
    error: result.valid ? null : sanitizeErrorMessage(result.error || null),
  };
}

async function probeOne(conn, opts) {
  const start = (opts.now ?? Date.now)();
  try {
    const prober = opts.prober ?? probeConnectionHealth;
    const result = await prober(conn, { fetcher: opts.fetcher });
    return mapResult(conn, result, (opts.now ?? Date.now)() - start);
  } catch (err) {
    return {
      id: conn.id,
      provider: conn.provider,
      name: conn.name || conn.provider,
      state: "down",
      latencyMs: (opts.now ?? Date.now)() - start,
      statusCode: null,
      error: sanitizeErrorMessage(err?.message || "probe failed"),
    };
  }
}

async function buildPayload(opts) {
  const now = opts.now ?? Date.now;
  const loader = opts.connectionsLoader ?? (() => getProviderConnections({ isActive: true }));
  const connections = (await loader()) || [];

  const settled = await Promise.allSettled(connections.map((c) => probeOne(c, opts)));
  const providers = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          id: connections[i]?.id ?? `idx-${i}`,
          provider: connections[i]?.provider ?? "unknown",
          name: connections[i]?.name ?? connections[i]?.provider ?? "unknown",
          state: "unknown",
          latencyMs: null,
          statusCode: null,
          error: sanitizeErrorMessage(String(r.reason)),
        }
  );

  const summary = { healthy: 0, degraded: 0, down: 0, blocked: 0, unconfigured: 0, unknown: 0, total: providers.length };
  for (const p of providers) summary[p.state] = (summary[p.state] || 0) + 1;

  return { timestamp: new Date(now()).toISOString(), summary, providers };
}

/**
 * Build (or serve cached) health payload. Concurrent misses share one build.
 *
 * @param {{ fetcher?: typeof fetch, now?: () => number, connectionsLoader?: Function, prober?: Function, force?: boolean }} [opts]
 * @returns {Promise<object>}
 */
export async function getHealthPayload(opts = {}) {
  const now = opts.now ?? Date.now;
  if (!opts.force && payloadCache && now() < payloadCache.expiresAt) {
    return payloadCache.payload;
  }
  if (!opts.force && pendingBuild) return pendingBuild;

  // A forced rebuild is an explicit invalidation: drop the cached payload and
  // bump the generation so any older in-flight normal build discards its result
  // instead of overwriting the fresh forced payload on a slower probe.
  if (opts.force) {
    payloadCache = null;
    buildGeneration += 1;
  }
  const generationAtStart = buildGeneration;
  const build = (async () => {
    try {
      const payload = await buildPayload(opts);
      // Only the generation that started this build may publish — and forced
      // builds publish too (they own the bumped generation).
      if (buildGeneration === generationAtStart) {
        payloadCache = { payload, expiresAt: (opts.now ?? Date.now)() + HEALTH_PAYLOAD_TTL_MS };
      }
      return payload;
    } finally {
      if (pendingBuild === build) pendingBuild = null;
    }
  })();
  // A forced rebuild does not take over the shared pending slot — normal reads
  // keep waiting on their own build instead of being hijacked / nulled by us.
  if (!opts.force) pendingBuild = build;
  return build;
}
