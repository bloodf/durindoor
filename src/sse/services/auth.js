import { isFreeNoAuthProviderDisabled } from "@/sse/services/freeProviderGate.js";
import {
  getProviderConnections, getProviderConnectionById, getApiKeyByKey, validateApiKey,
  updateProviderConnection, getSettings, getProxyPools,
  getQuotaReservationPressure,
} from "@/lib/localDb";
import { MEMORY_CONFIG } from "open-sse/config/runtimeConfig.js";
import { isApiKeyExpired } from "@/shared/utils/apiKeyExpiry";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isAntigravityCapacityError, isRecoverableCloudCodeProject403, buildModelLockUpdate, getActiveModelLockUntil, isPassthroughConnectionWideError } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS, RESET_COOLDOWN_CAP_MS } from "open-sse/config/errorConfig.js";
import { AI_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { PROVIDERS } from "open-sse/providers/index.js";
import * as log from "../utils/logger.js";
import { timingSafeEqual } from "node:crypto";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import {
  buildQuotaResourceKeys,
  evaluateProviderQuotaPreflight,
  inspectProviderQuota,
} from "@/shared/services/providerQuotaPreflight";
import { refreshProviderQuota } from "@/shared/services/providerQuotaTracker";
import {
  clearProviderRateLimitEvidence,
  recordProviderRateLimitEvidence,
} from "@/shared/services/providerRateLimitEvidence";
import { resolveFallbackModelScope } from "open-sse/services/fallbackScope.js";
import { getProviderQuotaConfig } from "open-sse/config/providerQuota.js";
import { getModelQuotaFamily, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { rankQuotaConnections } from "@/shared/services/quotaSelection";
import { quotaDecisionDiagnostic } from "open-sse/services/quota/scoring.js";
import { isQoderQuotaExhaustedBody } from "open-sse/executors/qoder.js";

const CLI_AUTH_SALT = "9r-cli-auth";
const GITHUB_MONTHLY_USAGE_LIMIT = "you've reached your additional usage limit for your plan";
const CODEX_PERMANENT_OAUTH_ERRORS = [
  "invalidated oauth token",
  "authentication token has been invalidated",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "refresh token already used",
];

function isCodexPermanentOAuthError(provider, status, errorText) {
  if (provider !== "codex" || Number(status) !== 401) return false;
  const text = String(errorText || "").toLowerCase();
  return CODEX_PERMANENT_OAUTH_ERRORS.some((sig) => text.includes(sig));
}

function githubMonthlyResetMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/**
 * Detect Qoder's permanent account quota signal from structured executor data.
 * Rendered messages are untrusted text and must not widen this trigger (#3331).
 */
function isQoderQuotaExhausted(status, errorText, provider, errorBody = null) {
  if (resolveProviderId(provider) !== "qoder" || Number(status) !== 403) return false;
  if (errorBody && typeof errorBody === "object") {
    return isQoderQuotaExhaustedBody(errorBody?.error?.message);
  }
  const candidate = String(errorText || "").trim().replace(/^\[\d+\]:\s*/, "");
  return candidate.startsWith("{") && isQoderQuotaExhaustedBody(candidate);
}
const FREE_TIER_STATIC_COOLDOWN_CAP_MS = 60 * 1000;
const SHORT_COOLDOWN_PROVIDERS = new Set([
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
]);
/**
 * Resolves decolua/9router#2895 static fallback policy after provider-reset
 * normalization. Configured delays win; free and free-tier providers cap only
 * the Auto/default fallback. Authoritative reset deadlines bypass this helper.
 * @param {string|null} provider
 * @param {number} defaultCooldownMs
 * @returns {Promise<{cooldownMs: number, configured: boolean}>}
 */
async function resolveStaticRetryCooldown(provider, defaultCooldownMs) {
  const providerKey = resolveProviderId(provider);
  let cooldownMs = defaultCooldownMs;
  let configured = false;
  try {
    const selectedSeconds = (await getSettings())?.retryDelayByProvider?.[providerKey];
    const seconds = Number(selectedSeconds);
    if (selectedSeconds != null && selectedSeconds !== "" && selectedSeconds !== "auto" && Number.isFinite(seconds) && seconds > 0) {
      cooldownMs = Math.min(seconds * 1000, MAX_RATE_LIMIT_COOLDOWN_MS);
      configured = true;
    }
  } catch {
    // Settings failure keeps the validated BACKOFF_CONFIG schedule.
  }
  if (!configured && SHORT_COOLDOWN_PROVIDERS.has(providerKey)) {
    cooldownMs = Math.min(cooldownMs, FREE_TIER_STATIC_COOLDOWN_CAP_MS);
  }
  return { cooldownMs, configured };
}

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

const sessionAffinityState = new Map();
const MAX_SESSION_AFFINITIES = 5000;

function normalizeSessionAffinityId(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 256) return null;
  return v;
}

function sessionAffinityKey(providerId, sessionId) {
  return `${providerId}:${sessionId}`;
}

function rememberSessionAffinity(providerId, sessionId, connectionId) {
  if (!providerId || !sessionId || !connectionId) return;
  if (sessionAffinityState.size >= MAX_SESSION_AFFINITIES) {
    sessionAffinityState.delete(sessionAffinityState.keys().next().value);
  }
  sessionAffinityState.set(sessionAffinityKey(providerId, sessionId), {
    connectionId,
    lastUsed: Date.now(),
  });
}

function getSessionAffinity(providerId, sessionId) {
  if (!providerId || !sessionId) return null;
  const entry = sessionAffinityState.get(sessionAffinityKey(providerId, sessionId));
  if (entry) entry.lastUsed = Date.now();
  return entry?.connectionId || null;
}

export function resetProviderSessionAffinity() {
  sessionAffinityState.clear();
}

const affinityCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessionAffinityState) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) {
      sessionAffinityState.delete(key);
    }
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (affinityCleanup.unref) affinityCleanup.unref();

const NO_AUTH_STORED_DATA_PROVIDERS = new Set(["mimocode"]);

// Canonical roster of providers eligible for the public no-auth fallback when
// no saved connection row exists. Mimocode stays in the roster so zero-row
// lookups still surface the ephemeral credential, while stored-but-unavailable
// Mimocode connections are suppressed by the stored-row branch below.
const PUBLIC_NO_AUTH_FALLBACK_PROVIDERS = new Set([
  "auggie",
  "chipotle",
  "duckduckgo-web",
  "mimocode",
  "opencode",
  "pollinations",
  "theoldllm",
]);

/** Whether auth may replace an unavailable saved key with the public credential. */
export function providerAllowsPublicNoAuthFallback(provider) {
  const providerId = resolveProviderId(provider);
  return PUBLIC_NO_AUTH_FALLBACK_PROVIDERS.has(providerId)
    && AI_PROVIDERS[providerId]?.noAuth === true;
}
/**
 * Builds a no-auth credential object: the public fallback when `connection`
 * is omitted, or a stored no-auth-provider connection (e.g. Mimocode) when
 * one is passed. `authType: "none"` is set on the returned object only —
 * it is never written back to the connection record or persisted.
 */
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
    authType: "none",
    _connection: connection || null,
  };
}

function buildOptionalNoAuthCredential() {
  return {
    id: "noauth",
    connectionName: "Public",
    isActive: true,
    authType: "none",
    providerSpecificData: {},
    connectionId: "noauth",
    _connection: null,
  };
}

function providerHasOptionalAuth(providerId) {
  return PROVIDERS[providerId]?.authType === "optional";
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
    firecrawlHeaders: connection.firecrawlHeaders,
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
  const sessionId = normalizeSessionAffinityId(options?.sessionId);

  // Resolve alias before coordination so aliases for one provider share a turn
  // while independent provider identities remain concurrent.
  const providerId = resolveProviderId(provider);

  // Free no-auth providers are gated by persisted settings; if disabled, return
  // a sentinel so every selector (direct and preflight) behaves identically.
  const settings = await getSettings().catch(() => null);
  if (isFreeNoAuthProviderDisabled(providerId, settings)) {
    return { providerDisabled: true };
  }
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
    const publicFallbackAllowed = providerAllowsPublicNoAuthFallback(providerId) && !excludeSet.has("noauth");

    if (isNoAuthProvider) {
      // Stored-data no-auth providers (e.g., mimocode) use saved connections first.
      // Once rows exist, they never fall back to the public no-auth credential.
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

    if (connections.length === 0 && providerHasOptionalAuth(providerId) && !excludeSet.has("noauth")) {
      return buildOptionalNoAuthCredential();
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
      if (providerHasOptionalAuth(providerId) && publicFallbackAllowed) {
        log.warn("AUTH", `${provider} | saved key unavailable, falling back to optional no-auth`);
        return buildOptionalNoAuthCredential();
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
    // For round-robin, honor existing session affinity before quota ranking so
    // a session that already picked an account stays on it when it remains eligible.
    const stickyConnectionId = sessionId && strategy === "round-robin"
      ? getSessionAffinity(providerId, sessionId)
      : null;
    const stickyConnection = stickyConnectionId
      ? availableConnections.find((c) => c.id === stickyConnectionId)
      : null;

    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      // skip strategy
    } else if (stickyConnection) {
      connection = stickyConnection;
      log.debug("AUTH", `${provider} | session-sticky ${sessionId.slice(0, 8)} → ${connection.id?.slice(0, 8)}`);
      connection = await updateProviderConnection(connection.id, {
        lastUsedAt: new Date().toISOString(),
      }) || connection;
    } else if (quotaRanked) {
      // Persistent pressure + last-selection history provide the fairness tier
      // for quota-comparable accounts. Atomic acquire remains the final arbiter.
      connection = availableConnections[0];
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;

      const pickOldest = () => {
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });
        return sortedByOldest[0];
      };

      if (sessionId) {
        connection = pickOldest();
        connection = await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        }) || connection;
      } else {
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
          connection = pickOldest();

          // Update lastUsedAt and reset count to 1 (await to ensure persistence)
          connection = await updateProviderConnection(connection.id, {
            lastUsedAt: new Date().toISOString(),
            consecutiveUseCount: 1
          }) || connection;
        }
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    if (connection && strategy === "round-robin" && sessionId) {
      rememberSessionAffinity(providerId, sessionId, connection.id);
    }

    throwIfAborted(signal);
    return projectProviderCredentials(connection, quotaDecisions.get(connection.id) || null);
  } finally {
    if (!releaseAfterPredecessor && resolveMutex) resolveMutex();
  }
}

/**
 * Get provider credentials with live upstream quota preflight (OmniRoute #6742).
 *
 * getProviderCredentials() only consults *persisted* quota snapshots when
 * skipping connections, so a connection whose snapshot is stale or never
 * recorded can be selected while already out of quota upstream. This wrapper
 * routes credential selection through the shared quota preflight exactly
 * once: when the chosen connection's cache decision asks for a refresh
 * (`shouldRefresh`), it awaits refreshProviderQuota(), evaluates the freshly
 * returned exact-source snapshots, and — when upstream reports the account
 * exhausted — re-calls the plain selector with the caller's original
 * exclusions. The refresh persists authoritative snapshots, so the selector's
 * own quota inspection natively skips the exhausted account and produces the
 * standard next-account or allRateLimited fallback (with correct retry
 * metadata). No exclusion-set accumulation and no synthetic unavailability
 * marks: persisted rows remain the single authority for both skip and
 * fallback shape.
 *
 * Fail-open semantics preserve every existing fallback: a refresh that
 * throws, is unsupported, or resolves with no usable result leaves the
 * original credentials untouched; `null` / `allRateLimited` results pass
 * through unchanged; AbortError always propagates. A connection is refreshed
 * at most once per call, so a stale/repository-mismatched loader that never
 * reflects tracker persistence cannot loop the same account forever — the
 * second stale decision for an already-refreshed id is returned fail-open.
 *
 * Mirrors upstream `getProviderCredentialsWithQuotaPreflight` (OmniRoute PR
 * #6742 swapped its credentialed route call sites to it). Durindoor maps 12:
 * chat, embeddings, fetch, imageEdit, imageGeneration, moderations, music,
 * rerank, search, stt, tts, video. Best-effort single-attempt routes
 * (count_tokens, Gemini-native v1beta) intentionally keep the plain selector.
 *
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentialsWithQuotaPreflight(provider, excludeConnectionIds = null, model = null, options = {}) {
  const signal = options?.signal || null;
  const providerId = resolveProviderId(provider);
  const quotaRefresher = options?.quotaRefresher || refreshProviderQuota;
  const resourceKeys = options?.resourceKeys || buildQuotaResourceKeys({
    provider: providerId,
    modelCandidates: options?.modelCandidates || (model ? [model] : []),
    quotaFamily: options?.quotaFamily || null,
  });
  // Bound live refreshes to one per connection id per call: if a loader never
  // reflects tracker persistence, the same account cannot loop forever.
  const refreshedConnectionIds = new Set();

  let credentials = await getProviderCredentials(provider, excludeConnectionIds, model, options);

  while (true) {
    // Unavailable/error fallbacks pass through untouched.
    if (!credentials || credentials.allRateLimited || !credentials.connectionId || credentials.connectionId === "noauth") {
      return credentials;
    }
    const connectionId = credentials.connectionId;
    const connection = credentials._connection;
    if (!credentials._quotaPreflight?.shouldRefresh || !connection || refreshedConnectionIds.has(connectionId)) {
      return credentials;
    }
    refreshedConnectionIds.add(connectionId);

    let refreshResult;
    try {
      refreshResult = await quotaRefresher(connection, { signal });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      log.warn("QUOTA", `${provider} | preflight refresh failed for ${String(connectionId).slice(0, 8)}; proceeding fail-open`);
      return credentials;
    }
    throwIfAborted(signal);

    // Missing/unsupported result: nothing was fetched or persisted, so keep
    // the original credentials (fail-open).
    if (!refreshResult) {
      return credentials;
    }

    // The tracker runs the credential refresher (persisting any rotated OAuth
    // tokens) BEFORE the quota fetch, so every resolved result — usable,
    // blocked, or non-success — may carry fresher credentials than the row we
    // selected. Reload the connection row and re-project with fresh tokens,
    // WITHOUT a second strategy commit (the selection already committed).
    const reloadFreshProjection = async () => {
      try {
        const freshRow = await getProviderConnectionById(connectionId);
        if (!freshRow || freshRow.id !== connectionId || resolveProviderId(freshRow.provider) !== providerId) {
          return credentials;
        }
        return await projectProviderCredentials(freshRow, credentials._quotaPreflight || null);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        return credentials;
      }
    };

    // Non-success outcome (timeout/provider_error/unauthenticated/…): no
    // blocking snapshots were persisted, so the account stays eligible —
    // fail-open on quota but still return the freshest credentials.
    if (refreshResult.outcome !== "success" || !Array.isArray(refreshResult.snapshots)) {
      return reloadFreshProjection();
    }

    // Immediate decision for logging only — persisted rows are the authority
    // for the reselect. Wall-clock now: snapshots were just fetched, and an
    // injected `options.now` (tests) must not make them look future-stale.
    const decision = evaluateProviderQuotaPreflight(refreshResult.snapshots, {
      connectionId,
      provider: providerId,
      resourceKeys,
      now: Date.now(),
      refreshSupported: true,
    });
    if (!decision?.skip) {
      // Upstream says the account is usable — return it with fresh tokens.
      return reloadFreshProjection();
    }

    // Upstream reports this account exhausted/blocked. The refresh persisted
    // authoritative snapshots, so re-call the plain selector with the
    // caller's ORIGINAL exclusions: its quota inspection now marks the
    // account `skip` natively, yielding the next eligible account or the
    // standard allRateLimited fallback with correct retry metadata.
    log.info("AUTH", `${provider} | quota preflight blocked ${String(connectionId).slice(0, 8)} (reason=${decision.reason || "unknown"}); reselecting`);
    credentials = await getProviderCredentials(provider, excludeConnectionIds, model, {
      ...options,
      now: Date.now(),
    });
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

  if (isCodexPermanentOAuthError(provider, status, errorText)) {
    const clearLocks = Object.fromEntries(
      Object.keys(conn || {})
        .filter((field) => field.startsWith("modelLock_"))
        .map((field) => [field, null]),
    );
    log.warn("AUTH", `${connectionId.slice(0, 8)} hit permanent Codex OAuth invalidation; quarantining for reauth [${status}]`);
    await updateProviderConnection(connectionId, {
      ...clearLocks,
      testStatus: "reauth_required",
      isActive: false,
      errorCode: status,
      lastError: "Codex OAuth token invalidated; reauthorization required",
      lastErrorAt: new Date(observedAt).toISOString(),
      backoffLevel: 0,
    });
    return { shouldFallback: true, cooldownMs: 0 };
  }
  // Qoder code 112 cannot recover through a timed model cooldown. Persist a
  // dedicated discriminator so renderers never mistake stale generic errors
  // for this automatic account-wide disable (#3331).
  if (isQoderQuotaExhausted(status, errorText, provider, context?.errorBody)) {
    const reason = typeof errorText === "string"
      ? errorText.slice(0, 200)
      : "Qoder quota exhausted (code 112)";
    const disabledAt = new Date(observedAt).toISOString();
    await updateProviderConnection(connectionId, {
      isActive: false,
      testStatus: "unavailable",
      lastError: reason,
      errorCode: 403,
      lastErrorAt: disabledAt,
      autoDisabledReason: reason,
      autoDisabledAt: disabledAt,
      backoffLevel: 0,
    });
    log.warn("AUTH", `${connectionId.slice(0, 8)} disabled: Qoder quota exhausted [403/code 112]`);
    return { shouldFallback: true, cooldownMs: 0 };
  }

  // GitHub premium-request exhaustion is account-wide until the next UTC month.
  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);

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
  const fallbackResult = checkFallbackError(
    status,
    errorText,
    backoffLevel,
    provider,
    context?.headers ?? null,
    context?.errorBody ?? null,
  );
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
  // Provider-specific precise cooldown (codex resets_at, kiro confirmed credit
  // exhaustion) is capped at a provider-appropriate max so a far-future reset
  // doesn't lock the account past its next low-frequency recheck (#2664).
  const cooldownCapMs = RESET_COOLDOWN_CAP_MS[provider] ?? MAX_RATE_LIMIT_COOLDOWN_MS;
  const normalizedReset = githubResetAtMs || (Number.isFinite(providerReset) && providerReset > now
    ? Math.min(providerReset, now + cooldownCapMs)
    : null);
  if (normalizedReset !== null) {
    shouldFallback = true;
    cooldownMs = Math.ceil(normalizedReset - now);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = fallbackResult);
    if (shouldFallback) {
      const staticRetry = await resolveStaticRetryCooldown(provider, cooldownMs);
      cooldownMs = staticRetry.cooldownMs;
      if (staticRetry.configured) newBackoffLevel = 0;
    }
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  cooldownMs = Math.max(0, Math.ceil(cooldownMs));
  const deadline = normalizedReset !== null
    ? normalizedReset
    : now + cooldownMs;
  const legacyCooldownMs = Math.max(
    0,
    githubResetAtMs ? Math.ceil(deadline - observedAt) : Math.min(Math.ceil(deadline - observedAt), cooldownCapMs),
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
  // #6888: only providers flagged `passthroughConnectionWideErrors` treat
  // connection-class failures (5xx, network) as account-wide. NVIDIA NIM is
  // currently the only opt-in provider; generic passthrough routers such as
  // OpenRouter keep 5xx responses model-scoped.
  const passthroughConnectionError = isPassthroughConnectionWideError(
    AI_PROVIDERS[resolveProviderId(provider)]?.passthroughConnectionWideErrors,
    status,
  );
  const providerRuleConnectionWide = fallbackResult.scope === "connection";
  const fallbackModel = resolveFallbackModelScope(provider, model, {
    accountWide: githubResetAtMs || accountWideRuntime || passthroughConnectionError || providerRuleConnectionWide,
  });
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
    // Never let ordinary request success clear a durable reauth_required state;
    // only a successful OAuth reconnect (which writes testStatus:"active"
    // directly) may revive the account. See connectionsRepo fallback-clear guard.
    const reauthPinned = conn.testStatus === "reauth_required" || conn.errorCode === "REAUTH";
    if (!reauthPinned && remainingActiveLocks.length === 0) {
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
 * Extract the first API key credential presented by a request.
 *
 * @param {Request} request
 * @returns {string | null}
 */
export function extractApiKey(request) {
  return extractApiKeyCandidates(request)[0] || null;
}

/**
 * Extract every distinct API key credential presented by one request, in
 * precedence order. Some Anthropic clients send a stale Bearer token beside a
 * valid `x-api-key`, so authentication must check both without trusting any
 * credential from another request.
 *
 * @param {Request} request
 * @returns {string[]}
 */
export function extractApiKeyCandidates(request) {
  if (!request?.headers?.get) return [];
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) add(authHeader.slice(7));
  add(request.headers.get("x-api-key"));
  add(request.headers.get("x-goog-api-key"));
  add(new URL(request.url).searchParams.get("key"));
  return candidates;
}

/**
 * Resolve all credentials presented by one request and return the credential
 * that authenticated. Unknown placeholder keys remain allowed only in local
 * mode, after every candidate has been checked for a valid stored identity.
 *
 * @param {Request} request
 * @param {{ required?: boolean, now?: number }} options
 * @returns {Promise<{apiKey: string | null, auth: object}>}
 */
export async function resolveClientApiKey(request, { required = false, now = Date.now() } = {}) {
  const candidates = extractApiKeyCandidates(request);
  if (await hasValidCliToken(request)) {
    return { apiKey: candidates[0] || null, auth: { ok: true, reason: null, stored: false, operator: true } };
  }
  for (const apiKey of candidates) {
    const auth = await evaluateApiKeyCredential(apiKey, { required: true, now });
    if (auth.ok) return { apiKey, auth };
  }
  const apiKey = candidates[0] || null;
  return { apiKey, auth: await evaluateApiKeyCredential(apiKey, { required, now }) };
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
async function evaluateApiKeyCredential(apiKey, { required, now }) {
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

export async function evaluateApiKeyAuth(apiKey, { required = false, now = Date.now(), request = null } = {}) {
  if (request) return (await resolveClientApiKey(request, { required, now })).auth;
  return evaluateApiKeyCredential(apiKey, { required, now });
}
