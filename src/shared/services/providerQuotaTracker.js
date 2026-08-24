import crypto from "node:crypto";
import {
  PROVIDER_QUOTA_DEFAULTS } from
"open-sse/config/providerQuota.js";
import { getProviderQuotaAdapter } from "open-sse/services/quota/providers/index.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import {
  recordQuotaFetchFailure,
  replaceProviderQuotaSnapshotsForSource } from
"@/lib/db/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { rotationGroupFor } from "open-sse/services/refreshSerializer.js";
import {
  canonicalizeQuotaNow,
  normalizeQuotaIdentifier,
  normalizeQuotaSnapshot,
  quotaIdentityKey } from
"@/shared/utils/quotaSnapshot";
import {
  QUOTA_FETCH_OUTCOMES,
  QUOTA_MAX_CLOCK_SKEW_MS,
  QUOTA_MAX_FRESHNESS_MS,
  QUOTA_MAX_RETRY_DELAY_MS,
  QUOTA_MAX_SOURCE_SNAPSHOTS } from
"@/shared/constants/quota";
import { isFunction, isObject, isString } from "../utils/typeChecks.js";

const VALID_FETCH_OUTCOMES = new Set(QUOTA_FETCH_OUTCOMES);
const SUCCESS_RESULT_KEYS = new Set(["attemptedAt", "outcome", "rows", "sourceId"]);
const FAILURE_RESULT_KEYS = new Set(["attemptedAt", "outcome", "retryAt", "sourceId"]);

function abortError(reason = "Provider quota refresh aborted") {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  return new DOMException("Provider quota refresh aborted", "AbortError");
}

function proxyOptionsFromConfig(config = {}) {
  config = config && isObject(config) ? config : {};
  return {
    connectionProxyEnabled: config.connectionProxyEnabled === true,
    connectionProxyUrl: config.connectionProxyUrl || "",
    connectionNoProxy: config.connectionNoProxy || "",
    vercelRelayUrl: config.vercelRelayUrl || "",
    strictProxy: config.strictProxy === true,
    disableEnvProxy: config.disableEnvProxy === true
  };
}

function connectionKeys(connection) {
  const provider = normalizeQuotaIdentifier(connection?.provider, "provider quota connection provider");
  const connectionId = normalizeQuotaIdentifier(connection?.id, "provider quota connection id");
  const revisionMs = Date.parse(connection?.updatedAt || "");
  const revision = Number.isFinite(revisionMs) ? new Date(revisionMs).toISOString() : "unversioned";
  return {
    provider,
    connectionId,
    baseKey: JSON.stringify([provider, connectionId]),
    cacheKey: JSON.stringify([provider, connectionId, revision])
  };
}

function cloneResult(value) {
  return isFunction(structuredClone) ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function normalizedRetryAt(value, attempted) {
  if (value === null || value === undefined) return null;
  if (!isString(value) || !value.trim() || value.length > 128) return undefined;
  const timestamp = new Date(value).getTime();
  if (
  !Number.isFinite(timestamp) ||
  timestamp < attempted.timestamp ||
  timestamp > attempted.timestamp + QUOTA_MAX_RETRY_DELAY_MS)
  return undefined;
  return new Date(timestamp).toISOString();
}

function composeSnapshot(row, {
  connectionId,
  provider,
  sourceId,
  observedAt,
  freshnessMs,
  now
}) {
  const observedMs = Date.parse(observedAt);
  const resetMs = row.resetAt ? Date.parse(row.resetAt) : Number.POSITIVE_INFINITY;
  const cooldownMs = row.cooldownUntil ? Date.parse(row.cooldownUntil) : Number.POSITIVE_INFINITY;
  const staleMs = Math.min(observedMs + freshnessMs, resetMs, cooldownMs);
  const snapshot = {
    identity: {
      connectionId,
      provider,
      accountKey: row.accountKey,
      resourceKey: row.resourceKey,
      dimensionKey: row.dimensionKey
    },
    state: row.state,
    amounts: row.amounts,
    timing: {
      observedAt,
      staleAt: new Date(staleMs).toISOString(),
      resetAt: row.resetAt || null,
      cooldownUntil: row.cooldownUntil || null
    },
    provenance: {
      sourceType: "provider_api",
      sourceId,
      reasonCode: null,
      metadata: row.metadata || {}
    }
  };
  return normalizeQuotaSnapshot(snapshot, { now });
}

function subscribe(entry, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal.reason));
  entry.subscribers += 1;
  return new Promise((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener?.("abort", onAbort);
      entry.subscribers -= 1;
      return true;
    };
    const onAbort = () => {
      if (!release()) return;
      if (!entry.settled && entry.subscribers === 0) entry.controller.abort(abortError(signal.reason));
      reject(abortError(signal.reason));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    entry.promise.then(
      (value) => {if (release()) resolve(cloneResult(value));},
      (error) => {if (release()) reject(error);}
    );
  });
}

/** Create an isolated, bounded tracker; exported for deterministic tests. */
export function createProviderQuotaTracker({
  resolveAdapter = getProviderQuotaAdapter,
  repository = { replaceProviderQuotaSnapshotsForSource, recordQuotaFetchFailure },
  fetchImpl = proxyAwareFetch,
  proxyResolver = resolveConnectionProxyConfig,
  credentialRefresher = refreshAndUpdateCredentials,
  now = Date.now,
  randomUUID = crypto.randomUUID,
  cacheTtlMs = PROVIDER_QUOTA_DEFAULTS.cacheTtlMs,
  maxCacheEntries = PROVIDER_QUOTA_DEFAULTS.maxCacheEntries,
  timeoutMs = PROVIDER_QUOTA_DEFAULTS.timeoutMs,
  maxResponseBytes = PROVIDER_QUOTA_DEFAULTS.maxResponseBytes
} = {}) {
  const cache = new Map();
  const inflight = new Map();
  const generations = new Map();
  const lastObservationMs = new Map();

  function hasBaseReference(baseKey) {
    for (const entry of cache.values()) if (entry.baseKey === baseKey) return true;
    for (const entry of inflight.values()) if (entry.baseKey === baseKey) return true;
    return false;
  }

  function cleanupBaseState(baseKey) {
    if (hasBaseReference(baseKey)) return;
    generations.delete(baseKey);
    lastObservationMs.delete(baseKey);
  }

  function evictCache(nowMs) {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= nowMs) {
        cache.delete(key);
        cleanupBaseState(entry.baseKey);
      }
    }
    while (cache.size > maxCacheEntries) {
      const key = cache.keys().next().value;
      const entry = cache.get(key);
      cache.delete(key);
      cleanupBaseState(entry?.baseKey);
    }
  }

  function superseded(sourceId, persisted = false, snapshots = undefined) {
    return {
      outcome: "superseded",
      sourceId,
      ...(snapshots === undefined ? null : { snapshots }),
      cached: false,
      persisted
    };
  }

  function isCurrent(keys, generation) {
    return generations.get(keys.baseKey) === generation;
  }

  async function persistFailure({ keys, sourceId, result, attempted, validationNow, generation, controller }) {
    controller.signal.throwIfAborted();
    if (!isCurrent(keys, generation)) return superseded(sourceId);
    try {
      await repository.recordQuotaFetchFailure({
        connectionId: keys.connectionId,
        provider: keys.provider,
        sourceId,
        outcome: result.outcome,
        attemptedAt: attempted.value,
        retryAt: result.retryAt || null,
        reasonCode: result.outcome
      }, {
        now: (validationNow || attempted).timestamp,
        signal: controller.signal,
        shouldCommit: () => isCurrent(keys, generation)
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw abortError(controller.signal.reason || error);
      if (error?.code === "PROVIDER_QUOTA_PERSISTENCE_SUPERSEDED" || !isCurrent(keys, generation)) {
        return superseded(sourceId);
      }
      throw error;
    }
    controller.signal.throwIfAborted();
    if (!isCurrent(keys, generation)) return superseded(sourceId, true);
    return {
      outcome: result.outcome,
      sourceId,
      retryAt: result.retryAt || null,
      cached: false,
      persisted: true
    };
  }

  async function execute(connection, adapter, keys, generation, controller) {
    const fail = (result, attempted, validationNow = attempted) => persistFailure({
      keys,
      sourceId: adapter.config.sourceId,
      result,
      attempted,
      validationNow,
      generation,
      controller
    });
    let proxyOptions = null;
    let activeConnection = connection;
    const attemptedClock = canonicalizeQuotaNow(now());
    try {
      // Provider eligibility is a pure, pre-I/O boundary. Unsupported credential
      // variants must not resolve proxies, rotate secrets, or contact upstreams.
      if (adapter.isConnectionEligible && adapter.isConnectionEligible(connection) !== true) {
        return fail({ outcome: "missing" }, attemptedClock);
      }
      const proxyConfig = proxyResolver ? await proxyResolver(connection.providerSpecificData) : null;
      controller.signal.throwIfAborted();
      proxyOptions = proxyOptionsFromConfig(proxyConfig);
      // Rotation-group providers (Codex "openai-auth0", Claude "anthropic-oauth")
      // mint a single-use refresh_token per refresh. A quota sweep touches many
      // sibling accounts near the same reset boundary; proactively refreshing
      // them in parallel makes Auth0/Anthropic revoke the whole token family and
      // brick every account but the last (openai/codex#9648). Skip proactive
      // refresh for them here and read quota with the still-valid access token;
      // genuine expiry is handled by the serialized reactive 401 path. Mirrors
      // the quotaAutoPing.js guard.
      if (
      connection.authType === "oauth" &&
      credentialRefresher &&
      rotationGroupFor(connection.provider) === null)
      {
        const refreshed = await credentialRefresher(connection, false, proxyOptions, {
          signal: controller.signal,
          shouldCommit: () => isCurrent(keys, generation)
        });
        controller.signal.throwIfAborted();
        if (!isCurrent(keys, generation)) return superseded(adapter.config.sourceId);
        activeConnection = refreshed.connection;
        const refreshedKeys = connectionKeys(activeConnection);
        if (refreshedKeys.baseKey !== keys.baseKey) {
          return fail({ outcome: "malformed" }, attemptedClock);
        }
        keys = refreshedKeys;
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw abortError(controller.signal.reason || error);
      if (
      error?.code?.includes?.("SUPERSEDED") ||
      error?.code === "PROVIDER_CONNECTION_REVISION_CONFLICT" ||
      error?.code === "PROVIDER_CONNECTION_NOT_FOUND" ||
      !isCurrent(keys, generation))
      {
        return superseded(adapter.config.sourceId);
      }
      if (error?.code === "PROVIDER_CREDENTIAL_REFRESH_TIMEOUT" || error?.name === "TimeoutError") {
        return fail({ outcome: "timeout" }, attemptedClock);
      }
      if (error?.code === "PROVIDER_REAUTH_REQUIRED") {
        return fail({ outcome: "unauthenticated" }, attemptedClock);
      }
      if (error?.code === "PROVIDER_REFRESH_RESULT_MALFORMED") {
        return fail({ outcome: "malformed" }, attemptedClock);
      }
      return fail({ outcome: "provider_error" }, attemptedClock);
    }

    let result;
    try {
      result = await adapter.fetchQuota({
        config: adapter.config,
        connection: activeConnection,
        fetchImpl,
        proxyOptions,
        signal: controller.signal,
        now,
        randomUUID,
        timeoutMs,
        maxResponseBytes
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw abortError(controller.signal.reason || error);
      if (!isCurrent(keys, generation)) return superseded(adapter.config.sourceId);
      return fail({ outcome: "provider_error" }, attemptedClock);
    }
    controller.signal.throwIfAborted();
    if (!isCurrent(keys, generation)) return superseded(adapter.config.sourceId);

    if (!result || !isObject(result) || Array.isArray(result) || !VALID_FETCH_OUTCOMES.has(result.outcome)) {
      return fail({ outcome: "malformed" }, attemptedClock);
    }
    const resultKeys = result.outcome === "success" ? SUCCESS_RESULT_KEYS : FAILURE_RESULT_KEYS;
    if (!hasOnlyKeys(result, resultKeys) || result.sourceId !== adapter.config.sourceId) {
      return fail({ outcome: "malformed" }, attemptedClock);
    }
    let attempted;
    let completionClock;
    try {
      completionClock = canonicalizeQuotaNow(now());
      attempted = canonicalizeQuotaNow(result.attemptedAt || completionClock.value);
    } catch {
      return fail({ outcome: "malformed" }, attemptedClock);
    }
    if (attempted.timestamp > completionClock.timestamp + QUOTA_MAX_CLOCK_SKEW_MS) {
      return fail({ outcome: "malformed" }, completionClock);
    }
    if (result.outcome !== "success") {
      const retryAt = normalizedRetryAt(result.retryAt, attempted);
      if (retryAt === undefined) return fail({ outcome: "malformed" }, completionClock);
      return fail({ outcome: result.outcome, retryAt }, attempted, completionClock);
    }
    if (
    result.sourceId !== adapter.config.sourceId ||
    !Array.isArray(result.rows) ||
    result.rows.length > QUOTA_MAX_SOURCE_SNAPSHOTS)
    return fail({ outcome: "malformed" }, attempted, completionClock);

    // A provider may finish two generations in the same millisecond. Allocate
    // a strictly increasing source clock so the newer generation can always
    // replace the older source set in Batch 1's monotonic repository.
    const previousObservation = lastObservationMs.get(keys.baseKey) || 0;
    if (attempted.timestamp <= previousObservation) {
      attempted = canonicalizeQuotaNow(previousObservation + 1);
    }
    if (attempted.timestamp > completionClock.timestamp + QUOTA_MAX_CLOCK_SKEW_MS) {
      return fail({ outcome: "malformed" }, completionClock);
    }
    lastObservationMs.set(keys.baseKey, attempted.timestamp);

    const freshnessMs = Math.min(
      Number.isSafeInteger(adapter.config.freshnessMs) ? adapter.config.freshnessMs : PROVIDER_QUOTA_DEFAULTS.freshnessMs,
      QUOTA_MAX_FRESHNESS_MS
    );
    let snapshots;
    try {
      snapshots = result.rows.map((row) => composeSnapshot(row, {
        ...keys,
        sourceId: result.sourceId,
        observedAt: attempted.value,
        freshnessMs,
        now: completionClock.timestamp
      }));
      const identities = new Set();
      for (const snapshot of snapshots) {
        const identity = quotaIdentityKey(snapshot.identity);
        if (identities.has(identity)) throw new Error("Duplicate provider quota identity");
        identities.add(identity);
      }
    } catch {
      return fail({ outcome: "malformed" }, attempted, completionClock);
    }
    controller.signal.throwIfAborted();
    if (!isCurrent(keys, generation)) return superseded(result.sourceId);

    let commitResult;
    try {
      commitResult = await repository.replaceProviderQuotaSnapshotsForSource({
        connectionId: keys.connectionId,
        provider: keys.provider,
        sourceId: result.sourceId,
        observedAt: attempted.value,
        snapshots,
        fetchState: {
          connectionId: keys.connectionId,
          provider: keys.provider,
          sourceId: result.sourceId,
          outcome: "success",
          attemptedAt: attempted.value
        }
      }, {
        now: completionClock.timestamp,
        signal: controller.signal,
        shouldCommit: () => isCurrent(keys, generation),
        returnCommitResult: true,
        allowCanonicalSentinels: true
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw abortError(controller.signal.reason || error);
      if (error?.code === "PROVIDER_QUOTA_PERSISTENCE_SUPERSEDED" || !isCurrent(keys, generation)) {
        return superseded(result.sourceId);
      }
      throw error;
    }
    controller.signal.throwIfAborted();
    if (!isCurrent(keys, generation)) return superseded(result.sourceId, true);
    const persistedSnapshots = commitResult && Array.isArray(commitResult.snapshots) ?
    commitResult.snapshots :
    snapshots;
    if (commitResult?.accepted === false) return superseded(result.sourceId, false, persistedSnapshots);
    const response = {
      outcome: "success",
      sourceId: result.sourceId,
      snapshots: persistedSnapshots,
      cached: false,
      persisted: true
    };
    const nowMs = now();
    const snapshotExpiry = persistedSnapshots.reduce((earliest, snapshot) => {
      const staleAt = Date.parse(snapshot.timing.staleAt);
      return Number.isFinite(staleAt) ? Math.min(earliest, staleAt) : earliest;
    }, Number.POSITIVE_INFINITY);
    cache.set(keys.cacheKey, {
      value: response,
      expiresAt: Math.min(nowMs + cacheTtlMs, snapshotExpiry),
      baseKey: keys.baseKey
    });
    evictCache(nowMs);
    return response;
  }

  async function refresh(connection, { signal, force = false } = {}) {
    if (signal?.aborted) throw abortError(signal.reason);
    const keys = connectionKeys(connection);
    const adapter = resolveAdapter(keys.provider);
    if (!adapter) return { outcome: "missing", supported: false, cached: false, persisted: false };
    const nowMs = now();
    evictCache(nowMs);
    if (!force) {
      const cached = cache.get(keys.cacheKey);
      if (cached && cached.expiresAt > nowMs) return { ...cloneResult(cached.value), cached: true };
      const shared = inflight.get(keys.cacheKey);
      if (shared && !shared.controller.signal.aborted) return subscribe(shared, signal);
    }

    // Object identity cannot be reused after cleanup, unlike integer counters.
    // That keeps late work superseded even when per-connection state is freed.
    const generation = Object.freeze({});
    generations.set(keys.baseKey, generation);
    const controller = new AbortController();
    const entry = { controller, subscribers: 0, settled: false, promise: null, baseKey: keys.baseKey };
    entry.promise = execute(connection, adapter, keys, generation, controller).finally(() => {
      entry.settled = true;
      if (inflight.get(keys.cacheKey) === entry) inflight.delete(keys.cacheKey);
      cleanupBaseState(keys.baseKey);
    });
    inflight.set(keys.cacheKey, entry);
    return subscribe(entry, signal);
  }

  function invalidate({ provider, connectionId } = {}) {
    const prefix = provider && connectionId ? JSON.stringify([provider, connectionId]).slice(0, -1) : null;
    const affectedBaseKeys = new Set();
    for (const key of cache.keys()) {
      if (!prefix || key.startsWith(prefix)) {
        affectedBaseKeys.add(cache.get(key)?.baseKey);
        cache.delete(key);
      }
    }
    for (const [key, entry] of inflight) {
      if (!prefix || key.startsWith(prefix)) {
        affectedBaseKeys.add(entry.baseKey);
        entry.controller.abort(abortError());
        inflight.delete(key);
      }
    }
    if (provider && connectionId) {
      const baseKey = JSON.stringify([provider, connectionId]);
      generations.delete(baseKey);
      lastObservationMs.delete(baseKey);
    } else {
      generations.clear();
      lastObservationMs.clear();
    }
    for (const baseKey of affectedBaseKeys) if (baseKey) cleanupBaseState(baseKey);
  }

  return {
    refresh,
    invalidate,
    clear: () => invalidate(),
    getCacheSize: () => cache.size,
    getInflightSize: () => inflight.size,
    getStateSize: () => generations.size + lastObservationMs.size
  };
}

const defaultProviderQuotaTracker = createProviderQuotaTracker();

export const refreshProviderQuota = (...args) => defaultProviderQuotaTracker.refresh(...args);
export const invalidateProviderQuota = (...args) => defaultProviderQuotaTracker.invalidate(...args);