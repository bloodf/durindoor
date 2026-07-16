import {
  getProviderConnections, getApiKeyByKey, validateApiKey,
  updateProviderConnection, getSettings, getProxyPools,
  getQuotaReservationPressure,
} from "@/lib/localDb";
import { isApiKeyExpired } from "@/shared/utils/apiKeyExpiry";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isAntigravityCapacityError, isRecoverableCloudCodeProject403, buildModelLockUpdate, getActiveModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import * as log from "../utils/logger.js";
import { timingSafeEqual } from "node:crypto";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import {
  buildQuotaResourceKeys,
  inspectProviderQuota,
} from "@/shared/services/providerQuotaPreflight";
import {
  clearProviderRateLimitEvidence,
  recordProviderRateLimitEvidence,
} from "@/shared/services/providerRateLimitEvidence";
import { resolveFallbackModelScope } from "open-sse/services/fallbackScope.js";
import { getProviderQuotaConfig } from "open-sse/config/providerQuota.js";
import { getModelQuotaFamily, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { rankQuotaConnections } from "@/shared/services/quotaSelection";
import { quotaDecisionDiagnostic } from "open-sse/services/quota/scoring.js";

const CLI_AUTH_SALT = "9r-cli-auth";

export async function hasValidCliToken(request) {
  const supplied = request?.headers?.get?.("x-9r-cli-token");
  if (!supplied) return false;
  const expected = await getConsistentMachineId(CLI_AUTH_SALT);
  const suppliedBytes = Buffer.from(String(supplied));
  const expectedBytes = Buffer.from(String(expected));
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

// Round-robin metadata still needs ordered selection within one provider, but
// unrelated providers must never queue behind each other's quota/settings I/O.
const selectionMutexes = new Map();

const NO_AUTH_STORED_DATA_PROVIDERS = new Set(["mimocode"]);

/** Whether auth may replace an unavailable saved key with the public credential. */
export function providerAllowsPublicNoAuthFallback(provider) {
  const providerId = resolveProviderId(provider);
  return AI_PROVIDERS[providerId]?.noAuth === true
    && !NO_AUTH_STORED_DATA_PROVIDERS.has(providerId);
}

function buildNoAuthCredential(providerSpecificData = {}, resolvedProxy = {}, connection = null) {
  return {
    id: connection?.id || "noauth",
    connectionName: connection?.displayName || connection?.name || connection?.email || connection?.id || "Public",
    isActive: true,
    accessToken: "public",
    providerSpecificData: {
      ...(providerSpecificData || {}),
      connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
      connectionProxyUrl: resolvedProxy.connectionProxyUrl,
      connectionNoProxy: resolvedProxy.connectionNoProxy,
      connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
      vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      strictProxy: resolvedProxy.strictProxy === true,
      disableEnvProxy: resolvedProxy.disableEnvProxy === true,
    },
    connectionId: connection?.id || "noauth",
    _connection: connection || null,
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Provider request aborted", "AbortError");
}

function waitForSelectionTurn(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Provider request aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, new DOMException("Provider request aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

/** Project a stored connection into the credential shape consumed by open-sse. */
export async function projectProviderCredentials(connection, quotaPreflight = null) {
  if (!connection) return null;
  const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
  return {
    authType: connection.authType,
    apiKey: connection.apiKey,
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    idToken: connection.idToken,
    expiresAt: connection.expiresAt,
    expiresIn: connection.expiresIn,
    lastRefreshAt: connection.lastRefreshAt,
    projectId: connection.projectId,
    connectionName: connection.displayName || connection.name || connection.email || connection.id,
    copilotToken: connection.providerSpecificData?.copilotToken,
    providerSpecificData: {
      ...(connection.providerSpecificData || {}),
      connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
      connectionProxyUrl: resolvedProxy.connectionProxyUrl,
      connectionNoProxy: resolvedProxy.connectionNoProxy,
      connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
      vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      strictProxy: resolvedProxy.strictProxy === true,
      disableEnvProxy: resolvedProxy.disableEnvProxy === true,
    },
    connectionId: connection.id,
    testStatus: connection.testStatus,
    lastError: connection.lastError,
    _connection: connection,
    _quotaPreflight: quotaPreflight,
  };
}

function requestedLockScopes(rawModel, boundedModel) {
  return [...new Set([boundedModel, rawModel].filter((value) => value !== undefined))];
}

function requestedModelLockActive(connection, rawModel, boundedModel, now) {
  return requestedModelLockUntil(connection, rawModel, boundedModel, now) !== null;
}

/** Shared read-only eligibility predicate used by combo preview and auth. */
export function isProviderConnectionModelLocked(connection, provider, model, now = Date.now()) {
  const boundedModel = resolveFallbackModelScope(resolveProviderId(provider), model);
  return requestedModelLockActive(connection, model, boundedModel, now);
}

function requestedModelLockUntil(connection, rawModel, boundedModel, now) {
  const deadlines = requestedLockScopes(rawModel, boundedModel)
    .map((scope) => getActiveModelLockUntil(connection, scope, now))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  return deadlines[0] || null;
}

function blockedRetryAt(connection, decision, rawModel, boundedModel, now) {
  const deadlines = [];
  let unknown = false;
  if (requestedModelLockActive(connection, rawModel, boundedModel, now)) {
    const deadline = requestedModelLockUntil(connection, rawModel, boundedModel, now);
    if (deadline) deadlines.push(deadline);
    else unknown = true;
  }
  if (decision?.skip) {
    if (decision.retryAt) deadlines.push(decision.retryAt);
    else unknown = true;
  }
  if (unknown || deadlines.length === 0) return null;
  return deadlines.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function summarizeBlockedConnections(connections, decisions, rawModel, boundedModel, now) {
  const blocked = connections.filter((connection) =>
    requestedModelLockActive(connection, rawModel, boundedModel, now) || decisions.get(connection.id)?.skip,
  );
  const legacyLocked = blocked.filter(
    (connection) => requestedModelLockActive(connection, rawModel, boundedModel, now),
  );
  // Authentication failures must not be hidden by an earlier priority account's
  // rate-limit lock. Legacy 429 deadlines are combined with quota decisions
  // below so a no-reset exhaustion cannot expose the local breaker as provider
  // Retry-After evidence.
  const legacy = legacyLocked.find((connection) => [401, 403].includes(Number(connection.errorCode)))
    || legacyLocked.find((connection) => Number(connection.errorCode) !== 429);
  if (legacy) {
    const code = Number(legacy.errorCode);
    const status = code >= 400 && code <= 599 ? code : 503;
    const message = status === 429
      ? "Rate limited"
      : status === 401
      ? "Authentication failed"
      : status === 403
        ? "Access forbidden"
        : "Provider unavailable";
    const retryAfter = status === 429
      ? requestedModelLockUntil(legacy, rawModel, boundedModel, now)
      : null;
    return {
      status,
      message,
      retryAfter,
      retryAfterHuman: retryAfter ? formatRetryAfter(retryAfter, now) : "",
    };
  }
  const retries = blocked.map((connection) => blockedRetryAt(
    connection,
    decisions.get(connection.id),
    rawModel,
    boundedModel,
    now,
  ));
  const earliest = retries.length > 0 && retries.every(Boolean) ? retries.sort()[0] : null;
  return {
    status: 429,
    message: "Rate limited",
    retryAfter: earliest,
    retryAfterHuman: earliest ? formatRetryAfter(earliest, now) : "",
  };
}

async function buildPublicNoAuthCredential(providerId) {
  const settings = await getSettings();
  const override = (settings.providerStrategies || {})[providerId] || {};
  const strategy = override.rotateStrategy || "none";
  let pickedId = override.proxyPoolId || null;
  if (strategy !== "none") {
    const allPools = await getProxyPools({ isActive: true });
    const poolIds = allPools.filter((p) => p.proxyUrl).map((p) => p.id);
    pickedId = pickProxyPoolId(poolIds, strategy, providerId);
  }
  const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
  return buildNoAuthCredential({}, resolvedProxy, null);
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  const signal = options?.signal || null;
  const selectionNow = options?.now ?? Date.now();
  throwIfAborted(signal);
  // Resolve alias before coordination so aliases for one provider share a turn
  // while independent provider identities remain concurrent.
  const providerId = resolveProviderId(provider);
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Acquire the provider-scoped selection turn. SQLite reservations, not this
  // mutex, remain the global capacity authority at dispatch time.
  const currentMutex = selectionMutexes.get(providerId) || Promise.resolve();
  let resolveMutex;
  let releaseAfterPredecessor = false;
  const ownMutex = new Promise(resolve => { resolveMutex = resolve; });
  selectionMutexes.set(providerId, ownMutex);
  ownMutex.then(() => {
    if (selectionMutexes.get(providerId) === ownMutex) selectionMutexes.delete(providerId);
  });

  try {
    try {
      await waitForSelectionTurn(currentMutex, signal);
    } catch (error) {
      if (error?.name === "AbortError") {
        releaseAfterPredecessor = true;
        currentMutex.finally(() => resolveMutex?.());
      }
      throw error;
    }
    throwIfAborted(signal);

    const boundedModel = resolveFallbackModelScope(providerId, model);

    const connections = await getProviderConnections({ provider: providerId, isActive: true });
    throwIfAborted(signal);
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    const resourceKeys = options?.resourceKeys || buildQuotaResourceKeys({
      provider: providerId,
      modelCandidates: options?.modelCandidates || (model ? [model] : []),
      quotaFamily: options?.quotaFamily || null,
    });
    const quotaDecisions = await inspectProviderQuota(connections, {
      provider: providerId,
      resourceKeys,
      now: selectionNow,
      snapshotsLoader: options?.quotaSnapshotsLoader || null,
      fetchStateLoader: options?.quotaFetchStateLoader || null,
    });
    throwIfAborted(signal);

    const isNoAuthProvider = AI_PROVIDERS[providerId]?.noAuth === true;
    const publicFallbackAllowed = !excludeSet.has("noauth");

    if (isNoAuthProvider) {
      // Stored-data no-auth providers (e.g., mimocode) use saved connections first
      // and never fall back to the public no-auth credential.
      if (NO_AUTH_STORED_DATA_PROVIDERS.has(providerId) && connections.length > 0) {
        const availableStoredConnections = connections.filter(
          (c) => !excludeSet.has(c.id) && !requestedModelLockActive(c, model, boundedModel, selectionNow) && !quotaDecisions.get(c.id)?.skip
        );
        const connection = preferredConnectionId
          ? availableStoredConnections.find((c) => c.id === preferredConnectionId)
          : availableStoredConnections[0];
        if (connection) {
          const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
          return {
            ...buildNoAuthCredential(connection.providerSpecificData || {}, resolvedProxy, connection),
            _quotaPreflight: quotaDecisions.get(connection.id) || null,
          };
        }
        // If all stored connections are model-locked, surface the earliest retry time so callers can back off.
        const blockedConnections = connections.filter(
          (c) => !excludeSet.has(c.id) && (requestedModelLockActive(c, model, boundedModel, selectionNow) || quotaDecisions.get(c.id)?.skip)
        );
        if (blockedConnections.length > 0) {
          const summary = summarizeBlockedConnections(blockedConnections, quotaDecisions, model, boundedModel, selectionNow);
          log.warn("AUTH", `${provider} | all stored accounts unavailable for requested scope`);
          return {
            allRateLimited: true,
            retryAfter: summary.retryAfter,
            retryAfterHuman: summary.retryAfterHuman,
            lastError: summary.message,
            lastErrorCode: summary.status,
          };
        }
        // Stored connections exist but all are excluded or unavailable; do not fall back to the public credential.
        if (connections.length > 0) {
          log.warn("AUTH", `${provider} | all ${connections.length} stored ${providerId} accounts unavailable`);
          return null;
        }
      }

      // Inject a public no-auth credential only when no real connection exists.
      if (connections.length === 0) {
        return publicFallbackAllowed ? buildPublicNoAuthCredential(providerId) : null;
      }
    }

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }
    // Filter out model-locked and excluded connections
    let availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (requestedModelLockActive(c, model, boundedModel, selectionNow)) return false;
      if (quotaDecisions.get(c.id)?.skip) return false;
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const locked = requestedModelLockActive(c, model, boundedModel, selectionNow);
      const quotaBlocked = quotaDecisions.get(c.id)?.skip === true;
      if (excluded || locked || quotaBlocked) {
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? "legacy_lock" : ""} ${quotaBlocked ? `quota_${quotaDecisions.get(c.id).reason}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      // For no-auth providers with a real saved key that is now excluded/locked,
      // fall back to the public no-auth credential instead of failing outright —
      // Pollinations (and similar) still serve unauthenticated traffic.
      if (isNoAuthProvider && publicFallbackAllowed) {
        log.warn("AUTH", `${provider} | saved key unavailable, falling back to public no-auth`);
        return buildPublicNoAuthCredential(providerId);
      }
      // Find earliest lock expiry across all connections for retry timing
      const blockedConns = connections.filter(
        (c) => !excludeSet.has(c.id) && (requestedModelLockActive(c, model, boundedModel, selectionNow) || quotaDecisions.get(c.id)?.skip)
      );
      if (blockedConns.length > 0) {
        const summary = summarizeBlockedConnections(blockedConns, quotaDecisions, model, boundedModel, selectionNow);
        log.warn("AUTH", `${provider} | all accounts unavailable for requested scope`);
        return {
          allRateLimited: true,
          retryAfter: summary.retryAfter,
          retryAfterHuman: summary.retryAfterHuman,
          lastError: summary.message,
          lastErrorCode: summary.status,
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }


    const settings = await getSettings();
    // Per-provider strategy overrides global setting
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";
    let quotaRanked = false;
    if (availableConnections.some((candidate) => quotaDecisions.get(candidate.id)?.quotaProfile?.tracked)) {
      try {
        const pressure = await getQuotaReservationPressure({
          provider: providerId,
          connectionIds: availableConnections.map((candidate) => candidate.id),
          now: selectionNow,
        });
        const ranked = rankQuotaConnections(availableConnections, quotaDecisions, pressure, {
          now: selectionNow,
          provider: providerId,
          config: settings.quotaSelection || {},
        });
        for (const candidate of ranked) {
          log.debug("QUOTA", `${provider} account candidate`, quotaDecisionDiagnostic(candidate.quotaDecision));
        }
        const eligibleRanked = ranked.filter((candidate) => candidate.quotaDecision?.eligible !== false);
        const floorBlocked = ranked.filter((candidate) => (
          candidate.quotaDecision?.eligible === false
          && candidate.quotaDecision?.reasons?.includes("below_routing_floor")
        ));
        if (eligibleRanked.length === 0 && floorBlocked.length > 0) {
          return {
            allRateLimited: true,
            retryAfter: null,
            retryAfterHuman: "",
            lastError: "Provider quota routing floor reached",
            lastErrorCode: 503,
            localQuotaFloor: true,
          };
        }
        quotaRanked = eligibleRanked.some((candidate) => candidate.quotaDecision?.comparable);
        if (quotaRanked || floorBlocked.length > 0) {
          availableConnections = eligibleRanked.map((candidate) => candidate.value);
        }
      } catch {
        // Operational pressure is an optimization over provider observations.
        // Repository errors preserve the established selection order.
        quotaRanked = false;
      }
    }

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      // skip strategy
    } else if (quotaRanked) {
      // Persistent pressure + last-selection history provide the fairness tier
      // for quota-comparable accounts. Atomic acquire remains the final arbiter.
      connection = availableConnections[0];
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;

      // Sort by lastUsed (most recent first) to find current candidate
      const byRecency = [...availableConnections].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
      });

      const current = byRecency[0];
      const currentCount = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        // Stay with current account
        connection = current;
        // Update lastUsedAt and increment count (await to ensure persistence)
        connection = await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        }) || connection;
      } else {
        // Pick the least recently used (excluding current if possible)
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        // Update lastUsedAt and reset count to 1 (await to ensure persistence)
        connection = await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        }) || connection;
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    throwIfAborted(signal);
    return projectProviderCredentials(connection, quotaDecisions.get(connection.id) || null);
  } finally {
    if (!releaseAfterPredecessor && resolveMutex) resolveMutex();
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null, context = {}) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const signal = context?.signal || null;
  throwIfAborted(signal);
  const observedAt = Number.isSafeInteger(context?.attemptStartedAt)
    ? context.attemptStartedAt
    : Date.now();
  const connections = await getProviderConnections({ provider });
  throwIfAborted(signal);
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  if ((provider === "antigravity" || provider === "agy") && isAntigravityCapacityError(status, errorText)) {
    log.warn("AUTH", `${connectionId.slice(0, 8)} hit Antigravity capacity; fallback without cooldown [${status}]`);
    return { shouldFallback: true, cooldownMs: 0 };
  }

  if (isRecoverableCloudCodeProject403(provider, status, errorText)) {
    log.warn("AUTH", `${connectionId.slice(0, 8)} hit recoverable Cloud Code project 403; fallback without cooldown`);
    return { shouldFallback: true, cooldownMs: 0 };
  }

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  let shouldFallback, cooldownMs, newBackoffLevel;
  const now = Date.now();
  // OmniRoute #6731: classify first so an explicit quota-exhausted body on an
  // apikey-category 429 is honored even when the caller supplied no evidence.
  // effectiveEvidence = caller-supplied evidence, else whatever checkFallbackError
  // parsed from the body; its state/reset then drive the deadline uniformly.
  const callerEvidence =
    context?.rateLimitEvidence && typeof context.rateLimitEvidence === "object"
      ? context.rateLimitEvidence
      : null;
  const fallbackResult = checkFallbackError(status, errorText, backoffLevel);
  const effectiveEvidence = callerEvidence || fallbackResult.rateLimitEvidence || null;
  const evidenceState = effectiveEvidence?.state === "exhausted" ? "exhausted" : "cooldown";
  // Precedence: (1) caller-supplied normalized evidence is authoritative — its
  // null reset is a deliberate rejection of any legacy reset; (2) a reset parsed
  // from the body by checkFallbackError wins; (3) otherwise the caller's legacy
  // resetsAtMs applies, so an explicit quota-exhausted 429 keeps its real reset
  // window instead of collapsing to the short transient bench.
  const parsedEvidenceReset = Number(fallbackResult.rateLimitEvidence?.resetAtMs);
  const rawProviderReset = callerEvidence
    ? callerEvidence.resetAtMs
    : Number.isFinite(parsedEvidenceReset) && parsedEvidenceReset > now
      ? parsedEvidenceReset
      : resetsAtMs;
  const providerReset = Number(rawProviderReset);
  const normalizedReset = Number.isFinite(providerReset) && providerReset > now
    ? Math.min(providerReset, now + MAX_RATE_LIMIT_COOLDOWN_MS)
    : null;
  if (normalizedReset !== null) {
    shouldFallback = true;
    cooldownMs = Math.ceil(Math.min(normalizedReset - now, MAX_RATE_LIMIT_COOLDOWN_MS));
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = fallbackResult);
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  cooldownMs = Math.max(0, Math.ceil(cooldownMs));
  const deadline = normalizedReset !== null
    ? normalizedReset
    : now + cooldownMs;
  const legacyCooldownMs = Math.max(
    0,
    Math.min(Math.ceil(deadline - observedAt), MAX_RATE_LIMIT_COOLDOWN_MS),
  );
  const reasonCode = Number(status) === 429
    ? "rate_limited"
    : (Number(status) === 401 || Number(status) === 403)
      ? "authentication_error"
      : Number(status) === 502
        ? "network_error"
        : "provider_error";
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const quotaFamily = getModelQuotaFamily(alias, model);
  const hasFamilyScope = Boolean(quotaFamily && getProviderQuotaConfig(provider)?.preflightScopes?.quotaFamilies?.[quotaFamily]);
  const accountWideRuntime = Number(status) === 429
    && evidenceState === "exhausted"
    && !hasFamilyScope
    && getProviderQuotaConfig(provider)?.runtimeScopes?.exhausted === "account";
  const fallbackModel = resolveFallbackModelScope(provider, model, { accountWide: accountWideRuntime });
  let atomicApplied = false;
  try {
    const db = await import("@/lib/localDb");
    if (typeof db.recordProviderConnectionFallbackState === "function") {
      await db.recordProviderConnectionFallbackState(connectionId, {
        model: fallbackModel,
        status,
        reasonCode,
        cooldownMs: legacyCooldownMs,
        backoffLevel: newBackoffLevel ?? backoffLevel,
        observedAt,
      }, { signal });
      atomicApplied = true;
    }
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    log.warn("AUTH", "Atomic fallback-state update failed; using compatibility update");
  }
  if (!atomicApplied) {
    const lockUpdate = buildModelLockUpdate(fallbackModel, legacyCooldownMs);
    await updateProviderConnection(connectionId, {
      ...lockUpdate,
      testStatus: "unavailable",
      lastError: reasonCode === "rate_limited" ? "Rate limited" : "Provider unavailable",
      errorCode: status,
      lastErrorAt: new Date(observedAt).toISOString(),
      backoffLevel: newBackoffLevel ?? backoffLevel,
    });
  }

  if (Number(status) === 429) {
    try {
      await recordProviderRateLimitEvidence({
        connectionId,
        provider,
        model,
        attemptStartedAt: observedAt,
        state: evidenceState,
        // A no-reset plan exhaustion is persisted without inventing the short
        // compatibility breaker as a provider reset. Generic cooldown evidence
        // may use that bounded local deadline.
        resetAtMs: evidenceState === "exhausted" ? normalizedReset : (normalizedReset || deadline),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      log.warn("QUOTA", "Runtime rate-limit evidence could not be persisted");
    }
  }

  log.warn("AUTH", `${connectionId.slice(0, 8)} locked requested scope for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  const retryAtKnown = !(Number(status) === 429 && evidenceState === "exhausted" && normalizedReset === null);
  return {
    shouldFallback: true,
    cooldownMs,
    retryAt: retryAtKnown ? new Date(deadline).toISOString() : null,
    retryAtKnown,
    status: Number(status) || 503,
  };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null, context = {}) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const signal = context?.signal || null;
  throwIfAborted(signal);
  const now = Number.isSafeInteger(context?.attemptStartedAt)
    ? context.attemptStartedAt
    : Date.now();
  const provider = context?.provider || conn?.provider;
  const fallbackModel = resolveFallbackModelScope(provider, model);
  let atomicApplied = false;
  try {
    const db = await import("@/lib/localDb");
    if (typeof db.clearProviderConnectionFallbackState === "function") {
      await db.clearProviderConnectionFallbackState(connectionId, { model: fallbackModel, observedAt: now }, { signal });
      atomicApplied = true;
    }
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    log.warn("AUTH", "Atomic fallback-state clear failed; using compatibility update");
  }

  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));
  if (!atomicApplied && (conn.testStatus || conn.lastError || allLockKeys.length > 0)) {
    const keysToClear = allLockKeys.filter(k => {
      if (fallbackModel && k === `modelLock_${fallbackModel}`) return true;
      if (model && k === `modelLock_${model}`) return true;
      if (model && k === "modelLock___all") return true;
      const expiry = conn[k];
      return expiry && new Date(expiry).getTime() <= now;
    });
    const remainingActiveLocks = allLockKeys.filter(k => {
      if (keysToClear.includes(k)) return false;
      const expiry = conn[k];
      return expiry && new Date(expiry).getTime() > now;
    });
    const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));
    if (remainingActiveLocks.length === 0) {
      Object.assign(clearObj, { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 });
    }
    if (Object.keys(clearObj).length > 0) await updateProviderConnection(connectionId, clearObj);
  }

  try {
    await clearProviderRateLimitEvidence({
      connectionId,
      provider,
      model,
      attemptStartedAt: now,
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    log.warn("QUOTA", "Runtime rate-limit evidence could not be cleared");
  }
}

/**
 * Extract API key from request headers
 */
/**
 * Resolve the API key credential used for the request.
 * Supports:
 * - Authorization: Bearer <key>
 * - x-api-key: <key>
 * - x-goog-api-key: <key> (Gemini native clients)
 * - ?key=<key> query parameter (Gemini native clients)
 *
 * @param {Request} request
 * @returns {string | null}
 */
export function extractApiKey(request) {
  if (!request?.headers?.get) return null;

  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  // Check Gemini native header and query parameter
  const googleApiKey = request.headers.get("x-goog-api-key");
  if (googleApiKey) {
    return googleApiKey;
  }

  const url = new URL(request.url);
  return url.searchParams.get("key") || null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

/**
 * Evaluate a caller credential before any model/provider work.
 *
 * Local mode still permits an unknown placeholder credential for compatibility,
 * but once a credential matches a stored row it must be active and unexpired.
 * This prevents an expired or malformed stored key from becoming a policy/usage
 * identity when global API-key enforcement is disabled.
 */
export async function evaluateApiKeyAuth(apiKey, { required = false, now = Date.now(), request = null } = {}) {
  if (await hasValidCliToken(request)) {
    return { ok: true, reason: null, stored: false, operator: true };
  }
  if (!apiKey) {
    return { ok: !required, reason: required ? "missing" : null, stored: false };
  }

  const record = await getApiKeyByKey(apiKey);
  if (!record) {
    return { ok: !required, reason: required ? "invalid" : null, stored: false };
  }

  const valid = record.isActive === true && !isApiKeyExpired(record.expiresAt, now);
  return { ok: valid, reason: valid ? null : "invalid", stored: true };
}
