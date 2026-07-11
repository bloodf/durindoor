import { getProviderQuotaConfig, PROVIDER_QUOTA_DEFAULTS } from "open-sse/config/providerQuota.js";
import { quotaScopedKey } from "open-sse/services/quota/normalize.js";
import {
  QUOTA_IDENTITY_DEFAULTS,
  QUOTA_MAX_CLOCK_SKEW_MS,
  QUOTA_MAX_RETRY_DELAY_MS,
} from "@/shared/constants/quota";

const BLOCKING_STATES = new Set(["exhausted", "cooldown"]);
const POSITIVE_STATES = new Set(["available", "low"]);
const DEFINITIVE_STATES = new Set([...BLOCKING_STATES, ...POSITIVE_STATES]);

const MISSING_DECISION = Object.freeze({
  eligible: true,
  skip: false,
  reason: "missing",
  freshness: "missing",
  retryAt: null,
  sourceId: null,
  matchedIdentity: null,
  shouldRefresh: false,
});

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function safeIdentity(snapshot) {
  const identity = snapshot?.identity;
  if (!identity) return null;
  return {
    connectionId: identity.connectionId,
    provider: identity.provider,
    resourceKey: identity.resourceKey,
    dimensionKey: identity.dimensionKey,
  };
}

function retryDeadline(snapshot, now) {
  const candidates = (snapshot?.state === "cooldown"
    ? [snapshot?.timing?.cooldownUntil]
    : [snapshot?.timing?.resetAt]
  ).filter((value) => {
    const parsed = timestamp(value);
    return parsed !== null && parsed > now;
  });
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

function decisionFromRows(rows, { now, shouldRefresh, retryMode = "latest" }) {
  const blockers = rows.filter((row) => BLOCKING_STATES.has(row.state));
  if (blockers.length > 0) {
    // Every applicable constraint must clear before this connection is usable.
    // A missing deadline is intentionally not fabricated.
    const deadlines = blockers.map((row) => retryDeadline(row, now)).filter(Boolean);
    const retryAt = deadlines.length === blockers.length
      ? deadlines.sort((a, b) => retryMode === "earliest" ? Date.parse(a) - Date.parse(b) : Date.parse(b) - Date.parse(a))[0]
      : null;
    const selected = blockers.find((row) => row.state === "cooldown") || blockers[0];
    return {
      eligible: false,
      skip: true,
      reason: selected.state,
      freshness: "fresh",
      retryAt,
      sourceId: selected.provenance?.sourceId || null,
      matchedIdentity: safeIdentity(selected),
      shouldRefresh,
    };
  }

  const selected = rows.find((row) => row.state === "low") || rows[0];
  return {
    eligible: true,
    skip: false,
    reason: selected?.state === "low" ? "low" : "available",
    freshness: "fresh",
    retryAt: null,
    sourceId: selected?.provenance?.sourceId || null,
    matchedIdentity: safeIdentity(selected),
    shouldRefresh,
  };
}

function normalizeResourceKeys(resourceKeys = []) {
  return new Set(
    [...resourceKeys]
      .filter((value) => typeof value === "string" && value.length > 0)
      .slice(0, 16),
  );
}

function isApplicable(snapshot, resourceKeys) {
  const resourceKey = snapshot?.identity?.resourceKey;
  return resourceKey === QUOTA_IDENTITY_DEFAULTS.resourceKey || resourceKeys.has(resourceKey);
}

function isFresh(snapshot, now) {
  const observedAt = timestamp(snapshot?.timing?.observedAt);
  const staleAt = timestamp(snapshot?.timing?.staleAt);
  return observedAt !== null && observedAt <= now && staleAt !== null && staleAt > now;
}

function namespaceOf(value) {
  return typeof value === "string" && value.includes(":") ? value.slice(0, value.indexOf(":")) : null;
}

function selectorMatches(row, selector, exactResources) {
  const resource = row?.identity?.resourceKey;
  const dimension = row?.identity?.dimensionKey;
  let resourceMatch = false;
  if (selector.resource === "account") resourceMatch = resource === QUOTA_IDENTITY_DEFAULTS.resourceKey;
  else if (selector.resource === "requested") resourceMatch = exactResources.has(resource);
  else if (selector.resourceKey) resourceMatch = resource === selector.resourceKey;
  else if (selector.resourceNamespace) resourceMatch = namespaceOf(resource) === selector.resourceNamespace;
  if (!resourceMatch) return false;

  const keys = Array.isArray(selector.dimensionKeys) ? selector.dimensionKeys : [];
  const namespaces = Array.isArray(selector.dimensionNamespaces) ? selector.dimensionNamespaces : [];
  if (keys.length === 0 && namespaces.length === 0) return true;
  return keys.includes(dimension) || namespaces.includes(namespaceOf(dimension));
}

function evaluateGate(rows, gate, exactResources, now, { connectionWide = false } = {}) {
  const selectors = (gate?.selectors || []).filter(
    (selector) => !(connectionWide && selector.resource === "requested"),
  );
  if (selectors.length === 0) return { decision: null, selected: [] };
  let selected = [];
  if (gate.choose === "first-present") {
    for (const selector of selectors) {
      const matches = rows.filter((row) => selectorMatches(row, selector, exactResources));
      if (matches.length > 0) { selected = matches; break; }
    }
  } else {
    selected = rows.filter((row) => selectors.some((selector) => selectorMatches(row, selector, exactResources)));
  }
  if (selected.length === 0) return { decision: null, selected };

  const fresh = selected.filter((row) => isFresh(row, now));
  const definitive = fresh.filter((row) => DEFINITIVE_STATES.has(row.state));
  const aggregate = gate.aggregate === "any-sufficient" ? "any-sufficient" : "all-required";
  if (aggregate === "any-sufficient") {
    const positive = definitive.filter((row) => POSITIVE_STATES.has(row.state));
    if (positive.length > 0) {
      return { decision: decisionFromRows(positive, { now, shouldRefresh: false }), selected };
    }
    const allBlocked = selected.every((row) => isFresh(row, now) && BLOCKING_STATES.has(row.state));
    if (allBlocked) {
      return {
        decision: decisionFromRows(selected, { now, shouldRefresh: false, retryMode: "earliest" }),
        selected,
      };
    }
  } else {
    const blockers = definitive.filter((row) => BLOCKING_STATES.has(row.state));
    if (blockers.length > 0) {
      return { decision: decisionFromRows(blockers, { now, shouldRefresh: false }), selected };
    }
    if (selected.every((row) => isFresh(row, now) && DEFINITIVE_STATES.has(row.state))) {
      return { decision: decisionFromRows(definitive, { now, shouldRefresh: false }), selected };
    }
  }

  if (fresh.some((row) => row.state === "error")) {
    return { decision: { ...MISSING_DECISION, reason: "tracker_error", freshness: "fresh" }, selected };
  }
  if (fresh.some((row) => row.state === "unknown")) {
    return { decision: { ...MISSING_DECISION, reason: "unknown", freshness: "fresh" }, selected };
  }
  return { decision: { ...MISSING_DECISION, reason: "stale", freshness: "stale" }, selected };
}

function failedFetchDecision(fetchState, now, refreshSupported) {
  if (!fetchState || fetchState.outcome === "success") return null;
  const attemptedAt = timestamp(fetchState.attemptedAt);
  if (attemptedAt === null || attemptedAt > now + QUOTA_MAX_CLOCK_SKEW_MS) return null;
  const retryAt = timestamp(fetchState.retryAt);
  const validRetryAt = retryAt !== null
    && retryAt >= attemptedAt
    && retryAt <= attemptedAt + QUOTA_MAX_RETRY_DELAY_MS
    ? retryAt
    : null;
  const nextRefreshAt = validRetryAt || Math.min(
    attemptedAt + PROVIDER_QUOTA_DEFAULTS.cacheTtlMs,
    attemptedAt + QUOTA_MAX_RETRY_DELAY_MS,
  );
  return {
    ...MISSING_DECISION,
    reason: "tracker_error",
    freshness: "fresh",
    retryAt: nextRefreshAt > now ? new Date(nextRefreshAt).toISOString() : null,
    sourceId: fetchState.sourceId || null,
    shouldRefresh: refreshSupported && now >= nextRefreshAt,
  };
}

/**
 * Build the exact persisted resource identities applicable to one catalog
 * model. Provider-specific aliases are configuration, never fuzzy matching.
 */
export function buildQuotaResourceKeys({ provider, modelCandidates = [], quotaFamily = null } = {}) {
  const keys = new Set();
  for (const model of [...modelCandidates].slice(0, 8)) {
    if (typeof model === "string" && model.trim()) keys.add(quotaScopedKey("model", model));
  }

  const config = getProviderQuotaConfig(provider);
  const aliases = config?.preflightScopes;
  const familyResource = quotaFamily ? aliases?.quotaFamilies?.[quotaFamily] : null;
  if (familyResource) keys.add(familyResource);
  for (const model of [...modelCandidates].slice(0, 8)) {
    const resource = aliases?.models?.[model];
    if (resource) keys.add(resource);
  }
  return [...keys];
}

/**
 * Side-effect-free quota decision for a single connection.
 *
 * Fresh runtime blockers are evaluated before provider-defined exact selectors.
 * Provider gates preserve required constraints, alternative pools, and priority
 * buckets. Unknown, stale, missing, foreign-source, repository-error, and
 * non-applicable observations fail open.
 */
export function evaluateProviderQuotaPreflight(snapshots = [], {
  connectionId = null,
  provider = null,
  resourceKeys = [],
  now = Date.now(),
  trackerError = false,
  fetchState = null,
  refreshSupported = false,
  connectionWide = false,
} = {}) {
  const clock = Number(now);
  const safeNow = Number.isFinite(clock) ? clock : Date.now();
  const exactResources = normalizeResourceKeys(resourceKeys);
  const forConnection = Array.isArray(snapshots)
    ? snapshots.filter((snapshot) => !connectionId || snapshot?.identity?.connectionId === connectionId)
    : [];

  const runtimeRows = forConnection.filter((snapshot) =>
    snapshot?.provenance?.sourceType === "response_headers"
    && isApplicable(snapshot, exactResources)
    && (!connectionWide || snapshot?.identity?.resourceKey === QUOTA_IDENTITY_DEFAULTS.resourceKey),
  );
  const freshRuntimeBlockers = runtimeRows.filter(
    (row) => isFresh(row, safeNow) && BLOCKING_STATES.has(row.state),
  );
  if (freshRuntimeBlockers.length > 0) {
    return decisionFromRows(freshRuntimeBlockers, { now: safeNow, shouldRefresh: false });
  }

  const resolvedProvider = provider || forConnection[0]?.identity?.provider || null;
  const config = getProviderQuotaConfig(resolvedProvider);
  const providerRows = forConnection.filter((snapshot) =>
    snapshot?.provenance?.sourceType === "provider_api"
    && snapshot?.provenance?.sourceId === config?.sourceId,
  );
  const gateResults = (config?.preflightPolicy?.gates || []).map((gate) =>
    evaluateGate(providerRows, gate, exactResources, safeNow, { connectionWide }),
  );
  const blocking = gateResults.map((result) => result.decision).filter((decision) => decision?.skip);
  if (blocking.length > 0) {
    const rows = blocking.map((decision) => ({
      state: decision.reason,
      timing: decision.reason === "cooldown"
        ? { cooldownUntil: decision.retryAt }
        : { resetAt: decision.retryAt },
      identity: decision.matchedIdentity,
      provenance: { sourceId: decision.sourceId },
    }));
    return decisionFromRows(rows, { now: safeNow, shouldRefresh: false });
  }
  const decisive = gateResults.map((result) => result.decision).filter(Boolean);
  const hasConfiguredRows = gateResults.some((result) => result.selected.length > 0);
  if (decisive.length > 0 && decisive.every((decision) =>
    decision.freshness === "fresh"
    && !decision.skip
    && POSITIVE_STATES.has(decision.reason),
  )) {
    const low = decisive.find((decision) => decision.reason === "low");
    return low || decisive[0];
  }

  if (trackerError) {
    return { ...MISSING_DECISION, reason: "tracker_error", shouldRefresh: refreshSupported };
  }
  const fetchFailure = failedFetchDecision(fetchState, safeNow, refreshSupported);
  if (fetchFailure) return fetchFailure;
  const staleDecision = decisive.find((decision) => decision.reason === "tracker_error")
    || decisive.find((decision) => decision.reason === "unknown")
    || decisive.find((decision) => decision.reason === "stale");
  if (staleDecision) return { ...staleDecision, shouldRefresh: refreshSupported };
  if (runtimeRows.length > 0 || hasConfiguredRows) {
    return { ...MISSING_DECISION, reason: "stale", freshness: "stale", shouldRefresh: refreshSupported };
  }
  return { ...MISSING_DECISION, shouldRefresh: refreshSupported };
}

/** Load persisted observations once and return safe decisions for candidates. */
export async function inspectProviderQuota(connections, {
  provider,
  resourceKeys = [],
  now = Date.now(),
  connectionWide = false,
  snapshotsLoader = null,
  fetchStateLoader = null,
} = {}) {
  const config = getProviderQuotaConfig(provider);
  const refreshSupported = Boolean(config);
  let snapshots = [];
  let fetchStates = new Map();
  let trackerError = false;
  try {
    const loader = snapshotsLoader || (async (query) => {
      const db = await import("@/lib/localDb");
      if (typeof db.listProviderQuotaSnapshots !== "function") return [];
      return db.listProviderQuotaSnapshots(query);
    });
    snapshots = await loader({ provider, includeStale: true, now });
    if (config?.sourceId) {
      const loadFetchState = fetchStateLoader || (snapshotsLoader ? async () => null : async (query) => {
        const db = await import("@/lib/localDb");
        if (typeof db.getQuotaFetchState !== "function") return null;
        return db.getQuotaFetchState(query, { now });
      });
      const entries = await Promise.all((connections || []).map(async (connection) => [
        connection.id,
        await loadFetchState({ connectionId: connection.id, provider, sourceId: config.sourceId }, { now }),
      ]));
      fetchStates = new Map(entries);
    }
  } catch {
    trackerError = true;
  }

  return new Map((connections || []).map((connection) => [
    connection.id,
    evaluateProviderQuotaPreflight(snapshots, {
      connectionId: connection.id,
      provider,
      resourceKeys,
      now,
      trackerError,
      fetchState: fetchStates.get(connection.id) || null,
      refreshSupported,
      connectionWide,
    }),
  ]));
}
