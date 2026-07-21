/**
 * Provider Health Monitor — cached availability probes for the user's
 * configured provider connections. A 60-second cache prevents provider probe
 * traffic from becoming quota traffic; forced refresh remains explicit.
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
import { inspectProviderQuota } from "@/shared/services/providerQuotaPreflight";
import { getRecentlyActiveConnectionIds } from "@/lib/db/repos/usageRepo";

// A connection that served a successful request within this window is treated
// as reachable even when its independent probe says otherwise (real traffic is
// a stronger liveness signal than a probe host that 5xx'd or rejected an OAuth
// token the live chat path accepts).
const RECENT_ACTIVITY_WINDOW_MS = 10 * 60 * 1000;

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

export const HEALTH_PAYLOAD_TTL_MS = 60_000;
const PUBLIC_QUOTA_REASONS = new Set(["available", "low", "exhausted", "cooldown", "unknown", "stale", "tracker_error", "missing"]);
const PUBLIC_QUOTA_FRESHNESS = new Set(["fresh", "stale", "missing"]);

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

function publicQuotaDecision(decision) {
  return {
    eligible: decision?.eligible !== false,
    skip: decision?.skip === true,
    reason: PUBLIC_QUOTA_REASONS.has(decision?.reason) ? decision.reason : "missing",
    freshness: PUBLIC_QUOTA_FRESHNESS.has(decision?.freshness) ? decision.freshness : "missing",
  };
}

function mapResult(conn, result, latencyMs, quotaDecision) {
  const name = conn.name || conn.provider;
  const quota = publicQuotaDecision(quotaDecision);
  if (!result) {
    return { id: conn.id, provider: conn.provider, name, state: "unconfigured", latencyMs, statusCode: null, error: null, quota };
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
      quota,
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
      quota,
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
    quota,
  };
}

async function probeOne(conn, opts, quotaDecision) {
  const start = (opts.now ?? Date.now)();
  try {
    const prober = opts.prober ?? probeConnectionHealth;
    const result = await prober(conn, { fetcher: opts.fetcher });
    return mapResult(conn, result, (opts.now ?? Date.now)() - start, quotaDecision);
  } catch {
    return {
      id: conn.id,
      provider: conn.provider,
      name: conn.name || conn.provider,
      state: "down",
      latencyMs: (opts.now ?? Date.now)() - start,
      statusCode: null,
      error: "probe failed",
      quota: publicQuotaDecision(quotaDecision),
    };
  }
}

async function buildPayload(opts) {
  const now = opts.now ?? Date.now;
  const loader = opts.connectionsLoader ?? (() => getProviderConnections({ isActive: true }));
  const connections = (await loader()) || [];

  const quotaDecisions = new Map();
  const byProvider = new Map();
  for (const connection of connections) {
    const group = byProvider.get(connection.provider) || [];
    group.push(connection);
    byProvider.set(connection.provider, group);
  }
  const quotaInspector = opts.quotaInspector ?? inspectProviderQuota;
  await Promise.all([...byProvider.entries()].map(async ([provider, group]) => {
    try {
      const decisions = await quotaInspector(group, {
        provider,
        now: now(),
        connectionWide: true,
        snapshotsLoader: opts.quotaSnapshotsLoader || null,
      });
      for (const connection of group) quotaDecisions.set(connection.id, decisions.get(connection.id));
    } catch {
      for (const connection of group) {
        quotaDecisions.set(connection.id, {
          eligible: true,
          skip: false,
          reason: "tracker_error",
          freshness: "missing",
        });
      }
    }
  }));

  const settled = await Promise.allSettled(connections.map((c) => probeOne(c, opts, quotaDecisions.get(c.id))));
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
          error: "probe failed",
          quota: publicQuotaDecision(quotaDecisions.get(connections[i]?.id)),
        }
  );

  // Overlay real request success: an independent probe can disagree with the
  // live chat path (probe-host 5xx, or an OAuth token the probe can't replay),
  // so a provider actively serving traffic can read as down/degraded. If the
  // connection completed a successful request recently, trust that over the
  // probe. Never override `blocked` (SSRF guard) or `unconfigured` (no key).
  const OVERRIDABLE = new Set(["down", "degraded", "unknown"]);
  const recentActivityLoader = opts.recentActivityLoader ?? getRecentlyActiveConnectionIds;
  let recentlyActive;
  try {
    recentlyActive = await recentActivityLoader(RECENT_ACTIVITY_WINDOW_MS, now());
  } catch {
    recentlyActive = new Set();
  }
  for (const p of providers) {
    if (recentlyActive.has(p.id) && OVERRIDABLE.has(p.state)) {
      p.state = "healthy";
      p.error = null;
      p.recentlyActive = true;
    }
  }

  const summary = { healthy: 0, degraded: 0, down: 0, blocked: 0, unconfigured: 0, unknown: 0, quotaUnavailable: 0, total: providers.length };
  for (const p of providers) {
    summary[p.state] = (summary[p.state] || 0) + 1;
    if (p.quota?.skip) summary.quotaUnavailable += 1;
  }

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
