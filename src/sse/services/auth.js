import { antigravityHealth, healthEnabled } from "open-sse/services/antigravityHealth.js";
import { canSelectConnection } from "@/lib/routing/connectionRecovery.js";
import { connectionHasCredential, credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { isFreeNoAuthProviderDisabled } from "@/sse/services/freeProviderGate.js";
import { isProviderModelDisabled } from "@/sse/services/disabledModelGate.js";
import { getProviderConnections, getProviderConnectionById, updateProviderConnection, getSettings, getProxyPools, getQuotaReservationPressure, getApiKeyProviderConnectionIds } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, getActiveModelLockUntil, isModelLockActive, countEligibleAccounts, isQuotaLockoutActive } from "open-sse/services/accountFallback.js";
import { AI_PROVIDERS, resolveProviderId, resolveProviderRpm } from "@/shared/constants/providers.js";
import { PROVIDERS } from "open-sse/providers/index.js";
import * as log from "../utils/logger.js";
import { buildQuotaResourceKeys, evaluateProviderQuotaPreflight, inspectProviderQuota } from "@/shared/services/providerQuotaPreflight";
import { refreshProviderQuota } from "@/shared/services/providerQuotaTracker";
import { resolveFallbackModelScope } from "open-sse/services/fallbackScope.js";
import { rankQuotaConnections, pickQuotaWeightedConnection, pickEarliestResetConnection } from "@/shared/services/quotaSelection";
import { quotaDecisionDiagnostic } from "open-sse/services/quota/scoring.js";
import { isOverLimit, recordRequest, retryAfterMs } from "./rpmLimiter.js";
import { isOverLimit as isRpdOverLimit, recordRequest as recordRpdRequest, retryAfterMs as rpdRetryAfterMs } from "./rpdLimiter.js";
import { evaluatePeakHourProtection } from "@/lib/providers/peakHourProtection";
import { isFunction, isObject, isString } from "../../shared/utils/typeChecks.js";
import { getSessionAffinity, normalizeSessionAffinityId, pickByCacheAffinity, rememberSessionAffinity } from "./auth/sessionAffinity.js";
import { OLLAMA_LOCAL_PROVIDER_ID, rankOllamaConnectionsByCatalog } from "./auth/ollamaRouting.js";
import { requestedModelLockActive, requestedModelLockUntil, summarizeBlockedConnections } from "./auth/connectionLocks.js";
import { hasValidCliToken, resolveClientApiKey, isValidApiKey } from "./auth/clientApiKeys.js";

// Round-robin metadata still needs ordered selection within one provider, but
// unrelated providers must never queue behind each other's quota/settings I/O.
const selectionMutexes = new Map();

export { resetProviderSessionAffinity } from "./auth/sessionAffinity.js";

const NO_AUTH_STORED_DATA_PROVIDERS = new Set(["mimocode", "devin-cli-agentic"]);
// Keyless self-hosted servers whose connection row carries what the request
// needs: Local Whisper's server URL, self-hosted Firecrawl's optional key and
// headers (its host prefers the Profile setting, see resolveFirecrawlBaseUrl).
// With an active row, the handler no-auth path takes normal connection
// selection, the same as a scoped key, so the row's credentials are sent.
const NO_AUTH_CONNECTION_HOST_PROVIDERS = new Set(["local-whisper", "firecrawl_custom"]);

// ─── ollama-local node routing (#2024) ───────────────────────────────────────
// Several Ollama nodes can run side by side, each stored as its own connection
// with its own models and its own health. A request for one model must only
// reach the nodes whose discovered catalog lists it, and a node that fails must
// not take the healthy ones down with it.
// Reading one node's catalog costs an /api/tags request (plus one /api/show per
// model on daemons that omit capabilities), so the routing verdict is memoized
// briefly instead of being re-read on every request.

// Canonical roster of providers eligible for the public no-auth fallback when
// no saved connection row exists. Mimocode stays in the roster so zero-row
// lookups still surface the ephemeral credential, while stored-but-unavailable
// Mimocode connections are suppressed by the stored-row branch below.
const PUBLIC_NO_AUTH_FALLBACK_PROVIDERS = new Set([
"auggie",
"chipotle",
"aihorde",
"duckduckgo-web",
"mimocode",
"opencode",
"pollinations",
"theoldllm"]
);

/** Whether auth may replace an unavailable saved key with the public credential. */
export function providerAllowsPublicNoAuthFallback(provider) {
  const providerId = resolveProviderId(provider);
  return PUBLIC_NO_AUTH_FALLBACK_PROVIDERS.has(providerId) &&
  AI_PROVIDERS[providerId]?.noAuth === true;
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
      disableEnvProxy: resolvedProxy.disableEnvProxy === true
    },
    connectionId: connection?.id || "noauth",
    authType: "none",
    _connection: connection || null
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
    _connection: null
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
      (error) => finish(reject, error)
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
    sessionToken: connection.sessionToken,
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
      disableEnvProxy: resolvedProxy.disableEnvProxy === true
    },
    connectionId: connection.id,
    testStatus: connection.testStatus,
    lastError: connection.lastError,
    _connection: connection,
    _quotaPreflight: quotaPreflight
  };
}

// Excluded accounts remain ineligible in this request. Only use a retryable
// model lock to improve an otherwise known quota-reset hint for a later request.
function includeExcludedModelRetry(summary, blocked, connections, exclusions, decisions, rawModel, boundedModel, now, rpmLimit) {
  if (!rawModel || summary.status !== 429 || !summary.retryAfter ||
      !blocked.every((connection) => decisions.get(connection.id)?.skip)) return summary;
  const deadlines = connections.filter((connection) =>
    exclusions.has(connection.id) && !isQuotaLockoutActive(connection, now) && ![401, 403].includes(Number(connection.errorCode)) &&
    !decisions.get(connection.id)?.skip &&
    !getActiveModelLockUntil(connection, null, now) &&
    !(new Date(connection.rateLimitedUntil || "").getTime() > now) &&
    !isConnectionGated(connection, now) && !isOverLimit(connection.id, rpmLimit, now)
  ).map((connection) => requestedModelLockUntil(connection, rawModel, boundedModel, now)).
  filter((deadline) => deadline && Date.parse(deadline) < Date.parse(summary.retryAfter)).
  sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!deadlines.length) return summary;
  return { ...summary, retryAfter: deadlines[0], retryAfterHuman: formatRetryAfter(deadlines[0], now) };
}

// port(omniroute): peak-hour protection + per-connection RPD (OmniRoute
// c11f661a8 #11622, c49ee53bc #12147). A connection in an active "block" peak
// window, or one that has spent its own providerSpecificData.rateLimitOverrides.rpd
// budget, is excluded from selection the same way a quota-skip is.
function peakHourBlockedState(connection, now) {
  const state = evaluatePeakHourProtection(connection?.providerSpecificData, new Date(now));
  return state.active && state.mode === "block" ? state : null;
}

function resolveConnectionRpd(connection) {
  const rpd = connection?.providerSpecificData?.rateLimitOverrides?.rpd;
  return Number.isFinite(rpd) && rpd > 0 ? rpd : 0;
}

function isConnectionGated(connection, now) {
  if (peakHourBlockedState(connection, now)) return true;
  const rpd = resolveConnectionRpd(connection);
  return rpd > 0 && isRpdOverLimit(connection.id, rpd, now);
}

function recordConnectionUsage(connection, rpmLimit, now) {
  recordRequest(connection.id, rpmLimit, now);
  const rpd = resolveConnectionRpd(connection);
  if (rpd > 0) recordRpdRequest(connection.id, rpd, now);
}

/** Build the allRateLimited contract when every candidate is peak-hour blocked or over its RPD cap. */
function summarizeGatedConnections(connections, now) {
  const gated = connections.filter((connection) => isConnectionGated(connection, now));
  if (connections.length === 0 || gated.length !== connections.length) return null;
  const retryDates = gated.
  map((connection) => {
    const peak = peakHourBlockedState(connection, now);
    if (peak) return peak.retryAfter;
    const rpd = resolveConnectionRpd(connection);
    const ms = rpdRetryAfterMs(connection.id, rpd, now);
    return ms ? new Date(ms).toISOString() : null;
  }).
  filter(Boolean);
  const retryAfter = retryDates.length > 0 ? retryDates.sort()[0] : null;
  return {
    allRateLimited: true,
    retryAfter,
    retryAfterHuman: retryAfter ? formatRetryAfter(retryAfter, now) : "",
    lastError: "All accounts blocked by peak-hour protection or daily request cap",
    lastErrorCode: 429
  };
}

/** Build existing allRateLimited contract when every otherwise-eligible account hits #3203 RPM cap. */
function summarizeRpmLimitedConnections(connections, rpmLimit, now) {
  if (connections.length === 0 || !connections.every(
    (connection) => isOverLimit(connection.id, rpmLimit, now)
  )) return null;
  const retryAtMs = Math.min(...connections.map(
    (connection) => retryAfterMs(connection.id, rpmLimit, now)
  ));
  const retryAfter = new Date(retryAtMs).toISOString();
  return {
    allRateLimited: true,
    retryAfter,
    retryAfterHuman: formatRetryAfter(retryAfter, now),
    lastError: "Rate limited",
    lastErrorCode: 429
  };
}

async function buildPublicNoAuthCredential(providerId, sessionId) {
  const settings = await getSettings();
  const override = (settings.providerStrategies || {})[providerId] || {};
  const strategy = override.rotateStrategy || "none";
  let pickedId = override.proxyPoolId || null;
  if (strategy !== "none") {
    const allPools = await getProxyPools({ isActive: true });
    const poolIds = allPools.filter((p) => p.proxyUrl).map((p) => p.id);
    pickedId = pickProxyPoolId(poolIds, strategy, providerId, sessionId);
  }
  const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
  return buildNoAuthCredential({}, resolvedProxy, null);
}

/**
 * Get provider credentials from localDb. When `options.apiKeyId` has relation
 * rows, only those provider-account ids participate in every eligibility,
 * quota, RPM, and fallback decision; zero rows preserve legacy unrestricted
 * API keys. This scope is independent of `policy.allowedModels`.
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 * @param {object} [options] - Selection options. `options.strictConnectionId`
 *   restricts selection to that single account for account-bound resources
 *   (e.g. polling a video job, which only exists on its creating account):
 *   no substitute is chosen when it is missing, inactive, or cooling down.
 *   `options.reportScopeDenied` opts into a `{scopeDenied:true}` result when
 *   key/combo account policy removes the provider pool, before availability checks.
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
  // Upstream 9router #4318: a model switched off in the dashboard is refused
  // before any account is picked. The result reuses the "no account can serve"
  // shape every caller already maps to `lastErrorCode` + `lastError`, so each
  // endpoint answers 403 with this message. No retryAfter: waiting won't help.
  if (model && await isProviderModelDisabled(provider, model)) {
    log.warn("AUTH", `${provider}/${model} is disabled in the dashboard, refusing request`);
    return {
      allRateLimited: true,
      modelDisabled: true,
      lastErrorCode: 403,
      lastError: `Model '${provider}/${model}' is disabled. Enable it in the dashboard to use it.`
    };
  }
  /** decolua/9router#3203: blank settings default NVIDIA to 40 RPM; other providers stay unlimited. */
  const rpmLimit = resolveProviderRpm(settings, providerId);
  // Persisted empty/unset combo allow-lists mean unrestricted. A derived
  // nested intersection may be `[]`, however, and is deny-all. Callers mark
  // that case with `restrictionApplied:true` so an empty intersection never
  // silently widens back to unrestricted.
  const restrictionApplied = options?.restrictionApplied === true ||
  Array.isArray(options?.allowedConnectionIds) && options.allowedConnectionIds.length > 0;
  const allowedConnectionIds = restrictionApplied ?
  new Set(Array.isArray(options?.allowedConnectionIds) ? options.allowedConnectionIds : []) :
  null;
  const excludeSet = excludeConnectionIds instanceof Set ?
  new Set(excludeConnectionIds) :
  excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set();
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Acquire the provider-scoped selection turn. SQLite reservations, not this
  // mutex, remain the global capacity authority at dispatch time.
  const currentMutex = selectionMutexes.get(providerId) || Promise.resolve();
  let resolveMutex;
  let releaseAfterPredecessor = false;
  const ownMutex = new Promise((resolve) => {resolveMutex = resolve;});
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

    const boundedModel = resolveFallbackModelScope(providerId, model, { webFetch: options?.webFetch === true, webSearch: options?.webSearch === true, videoPoll: options?.videoPoll === true });

    // API-key provider-account relations and combo allow-lists both narrow the
    // eligible pool. Their intersection is authoritative; a derived empty
    // intersection denies instead of widening back to unrestricted.
    const relationIds = options?.apiKeyId ?
    new Set(await getApiKeyProviderConnectionIds(options.apiKeyId)) :
    null;
    const allowlistIds = restrictionApplied ? allowedConnectionIds : null;
    let scopedConnectionIds = relationIds && relationIds.size > 0 ? relationIds : null;
    if (allowlistIds) {
      scopedConnectionIds = scopedConnectionIds ?
      new Set([...scopedConnectionIds].filter((id) => allowlistIds.has(id))) :
      allowlistIds;
    }
    const scopeRestricted = scopedConnectionIds !== null;
    const scopedHasOverlap = !scopeRestricted || scopedConnectionIds.size > 0;
    // Account-bound resources (a video job lives on the account that created
    // it) must never fall back to a different owner, even when the pinned
    // account is missing, deactivated or cooling down. Substituting another
    // account there cannot succeed upstream and bills the wrong account.
    const strictConnectionId = options?.strictConnectionId || null;
    const providerConnections = scopedHasOverlap ?
    await getProviderConnections({ provider: providerId, isActive: true }) : [];
    const scopedConnections = providerConnections.filter(
      (connection) => !scopeRestricted || scopedConnectionIds.has(connection.id)
    );
    const connections = scopedConnections.filter(
      (connection) => !strictConnectionId || connection.id === strictConnectionId
    );
    throwIfAborted(signal);
    // Chat combos distinguish local scope denial from missing credentials without
    // exposing account/model identities or changing legacy credential callers.
    if (options?.reportScopeDenied && scopeRestricted &&
    (!scopedHasOverlap || providerConnections.length > 0 && scopedConnections.length === 0)) return { scopeDenied: true };
    if (preferredConnectionId && scopeRestricted && !scopedConnectionIds.has(preferredConnectionId)) {
      log.warn("AUTH", `${provider} | preferred connection ${preferredConnectionId.slice(0, 8)} rejected by scoped allow-list`);
      return null;
    }
    if (strictConnectionId && connections.length === 0) return null;
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}, scope: ${scopeRestricted ? `restricted[${scopedConnectionIds.size}]` : "unrestricted"}`);

    const resourceKeys = options?.resourceKeys || buildQuotaResourceKeys({
      provider: providerId,
      modelCandidates: options?.modelCandidates || (model ? [model] : []),
      quotaFamily: options?.quotaFamily || null
    });
    const quotaDecisions = await inspectProviderQuota(connections, {
      provider: providerId,
      resourceKeys,
      now: selectionNow,
      snapshotsLoader: options?.quotaSnapshotsLoader || null,
      fetchStateLoader: options?.quotaFetchStateLoader || null
    });
    throwIfAborted(signal);

    const isNoAuthProvider = AI_PROVIDERS[providerId]?.noAuth === true || options?.noAuthPath === true;
    const hasSavedHost = NO_AUTH_CONNECTION_HOST_PROVIDERS.has(providerId) && connections.length > 0;
    // A saved host row that is gated or rate-limited must surface that state,
    // never fall back to a credential that calls the default host.
    const publicFallbackAllowed = !hasSavedHost && !scopeRestricted && scopedHasOverlap && (options?.noAuthPath === true || providerAllowsPublicNoAuthFallback(providerId)) && !excludeSet.has("noauth");
    // Explicit handler no-auth paths historically ignored saved connections.
    // Preserve that zero-relation behavior; any API-key/combo restriction opts
    // the caller into selecting a stored eligible connection or denying.
    if (options?.noAuthPath === true && !strictConnectionId && !scopeRestricted && !hasSavedHost) {
      return buildOptionalNoAuthCredential();
    }

    if (isNoAuthProvider) {
      // Stored-data no-auth providers (e.g., mimocode) use saved connections first.
      // Once rows exist, they never fall back to the public no-auth credential.
      if (NO_AUTH_STORED_DATA_PROVIDERS.has(providerId) && connections.length > 0) {
        const storedEligibleBeforeRpm = connections.filter(
          (c) => !excludeSet.has(c.id) &&
          !requestedModelLockActive(c, model, boundedModel, selectionNow) &&
          !isQuotaLockoutActive(c, selectionNow) &&
          !quotaDecisions.get(c.id)?.skip &&
          !isConnectionGated(c, selectionNow)
        );
        const availableStoredConnections = storedEligibleBeforeRpm.filter(
          (connection) => !isOverLimit(connection.id, rpmLimit, selectionNow)
        );
        const connection = preferredConnectionId ?
        availableStoredConnections.find((c) => c.id === preferredConnectionId) :
        availableStoredConnections[0];
        if (connection) {
          const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
          const credentials = {
            ...buildNoAuthCredential(connection.providerSpecificData || {}, resolvedProxy, connection),
            _quotaPreflight: quotaDecisions.get(connection.id) || null
          };
          recordConnectionUsage(connection, rpmLimit, selectionNow);
          return credentials;
        }
        const rpmCandidates = connections.filter((connection) => !excludeSet.has(connection.id));
        const gatedSummary = summarizeGatedConnections(rpmCandidates, selectionNow);
        if (gatedSummary) return gatedSummary;
        const rpmSummary = summarizeRpmLimitedConnections(rpmCandidates, rpmLimit, selectionNow);
        if (rpmSummary) return rpmSummary;
        // If all stored connections are model-locked, surface the earliest retry time so callers can back off.
        const blockedConnections = connections.filter(
          (c) => !excludeSet.has(c.id) && (requestedModelLockActive(c, model, boundedModel, selectionNow) || isQuotaLockoutActive(c, selectionNow) || quotaDecisions.get(c.id)?.skip)
        );
        if (blockedConnections.length > 0) {
          const summary = includeExcludedModelRetry(summarizeBlockedConnections(blockedConnections, quotaDecisions, model, boundedModel, selectionNow), blockedConnections, connections, excludeSet, quotaDecisions, model, boundedModel, selectionNow, rpmLimit);
          log.warn("AUTH", `${provider} | all stored accounts unavailable for requested scope`);
          return {
            allRateLimited: true,
            retryAfter: summary.retryAfter,
            retryAfterHuman: summary.retryAfterHuman,
            lastError: summary.message,
            lastErrorCode: summary.status
          };
        }
        // Stored connections exist but all are excluded or unavailable; do not fall back to the public credential.
        if (connections.length > 0) {
          log.warn("AUTH", `${provider} | all ${connections.length} stored ${providerId} accounts unavailable`);
          return null;
        }
      }

      // Inject a public no-auth credential only when no real connection exists.
      if (scopedHasOverlap && connections.length === 0) {
        return publicFallbackAllowed ? buildPublicNoAuthCredential(providerId, sessionId) : null;
      }
      if (!scopedHasOverlap) {
        log.warn("AUTH", `${provider} | scope produced empty intersection; denying`);
        return null;
      }
    }

    if (connections.length === 0 && scopedHasOverlap && !scopeRestricted && providerHasOptionalAuth(providerId) && !excludeSet.has("noauth")) {
      return buildOptionalNoAuthCredential();
    }
    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }
    // decolua/9router#3203: evaluate RPM without spending budget; record only final selection.
    const eligibleBeforeRpm = connections.filter((c) => {
      if (excludeSet.has(c.id)) return false;
      if (isQuotaLockoutActive(c, selectionNow)) return false;
      if (requestedModelLockActive(c, model, boundedModel, selectionNow)) return false;
      if (quotaDecisions.get(c.id)?.skip) return false;
      if (options?.connectionRecovery && !canSelectConnection(c, model, boundedModel, selectionNow)) return false;
      if (isConnectionGated(c, selectionNow)) return false;
      return true;
    });
    let availableConnections = eligibleBeforeRpm.filter(
      (connection) => !isOverLimit(connection.id, rpmLimit, selectionNow)
    );

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach((c) => {
      const excluded = excludeSet.has(c.id);
      const locked = requestedModelLockActive(c, model, boundedModel, selectionNow);
      const quotaBlocked = quotaDecisions.get(c.id)?.skip === true;
      const rpmBlocked = isOverLimit(c.id, rpmLimit, selectionNow);
      const gated = isConnectionGated(c, selectionNow);
      if (excluded || locked || quotaBlocked || rpmBlocked || gated) {
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? "legacy_lock" : ""} ${quotaBlocked ? `quota_${quotaDecisions.get(c.id).reason}` : ""} ${rpmBlocked ? `rpm_${rpmLimit}` : ""} ${gated ? "peak_hour_or_rpd" : ""}`);
      }
    });

    const recoveryBlocked = options?.connectionRecovery ? connections.filter((c) =>
      !excludeSet.has(c.id) && !requestedModelLockActive(c, model, boundedModel, selectionNow) &&
      !isQuotaLockoutActive(c, selectionNow) && !quotaDecisions.get(c.id)?.skip && !isConnectionGated(c, selectionNow) &&
      !isOverLimit(c.id, rpmLimit, selectionNow) &&
      !canSelectConnection(c, model, boundedModel, selectionNow)) : [];
    if (recoveryBlocked.some((c) => c.id === preferredConnectionId) ||
        availableConnections.length === 0 && recoveryBlocked.length > 0) {
      return { connectionRecoveryBusy: true };
    }

    if (availableConnections.length === 0) {
      // For no-auth providers with a real saved key that is now excluded/locked,
      // fall back to the public no-auth credential instead of failing outright —
      // Pollinations (and similar) still serve unauthenticated traffic.
      if (isNoAuthProvider && publicFallbackAllowed) {
        log.warn("AUTH", `${provider} | saved key unavailable, falling back to public no-auth`);
        return buildPublicNoAuthCredential(providerId, sessionId);
      }
      if (providerHasOptionalAuth(providerId) && publicFallbackAllowed) {
        log.warn("AUTH", `${provider} | saved key unavailable, falling back to optional no-auth`);
        return buildOptionalNoAuthCredential();
      }
      const rpmCandidates = connections.filter((connection) => !excludeSet.has(connection.id));
      const gatedSummary = summarizeGatedConnections(rpmCandidates, selectionNow);
      if (gatedSummary) {
        log.warn("AUTH", `${provider} | all ${rpmCandidates.length} accounts blocked by peak-hour protection or RPD cap`);
        return gatedSummary;
      }
      const rpmSummary = summarizeRpmLimitedConnections(rpmCandidates, rpmLimit, selectionNow);
      if (rpmSummary) {
        log.warn("AUTH", `${provider} | all ${rpmCandidates.length} accounts at ${rpmLimit} RPM cap`);
        return rpmSummary;
      }
      // Find earliest lock expiry across all connections for retry timing
      const blockedConns = connections.filter(
        (c) => !excludeSet.has(c.id) && (requestedModelLockActive(c, model, boundedModel, selectionNow) || isQuotaLockoutActive(c, selectionNow) || quotaDecisions.get(c.id)?.skip)
      );
      if (blockedConns.length > 0) {
        const summary = includeExcludedModelRetry(summarizeBlockedConnections(blockedConns, quotaDecisions, model, boundedModel, selectionNow), blockedConns, connections, excludeSet, quotaDecisions, model, boundedModel, selectionNow, rpmLimit);
        log.warn("AUTH", `${provider} | all accounts unavailable for requested scope`);
        return {
          allRateLimited: true,
          retryAfter: summary.retryAfter,
          retryAfterHuman: summary.retryAfterHuman,
          lastError: summary.message,
          lastErrorCode: summary.status
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const selectionSettings = await getSettings();
    // Per-provider strategy overrides global setting.
    const providerOverride = (selectionSettings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || selectionSettings.fallbackStrategy || "fill-first";
    let quotaRanked = false;
    // Populated alongside quotaRanked so the quota-weighted strategy below can
    // draw from the same ranked/eligible pool instead of re-deriving it.
    let quotaRankedEligible = null;
    if (availableConnections.some((candidate) => quotaDecisions.get(candidate.id)?.quotaProfile?.tracked)) {
      try {
        const pressure = await getQuotaReservationPressure({
          provider: providerId,
          connectionIds: availableConnections.map((candidate) => candidate.id),
          now: selectionNow
        });
        const ranked = rankQuotaConnections(availableConnections, quotaDecisions, pressure, {
          now: selectionNow,
          provider: providerId,
          config: selectionSettings.quotaSelection || {}
        });
        for (const candidate of ranked) {
          log.debug("QUOTA", `${provider} account candidate`, quotaDecisionDiagnostic(candidate.quotaDecision));
        }
        const eligibleRanked = ranked.filter((candidate) => candidate.quotaDecision?.eligible !== false);
        const floorBlocked = ranked.filter((candidate) =>
        candidate.quotaDecision?.eligible === false &&
        candidate.quotaDecision?.reasons?.includes("below_routing_floor")
        );
        if (eligibleRanked.length === 0 && floorBlocked.length > 0) {
          return {
            allRateLimited: true,
            retryAfter: null,
            retryAfterHuman: "",
            lastError: "Provider quota routing floor reached",
            lastErrorCode: 503,
            localQuotaFloor: true
          };
        }
        quotaRanked = eligibleRanked.some((candidate) => candidate.quotaDecision?.comparable);
        if (quotaRanked || floorBlocked.length > 0) {
          quotaRankedEligible = eligibleRanked;
          availableConnections = eligibleRanked.map((candidate) => candidate.value);
        }
      } catch {
        // Operational pressure is an optimization over provider observations.
        // Repository errors preserve the established selection order.
        quotaRanked = false;
      }
    }

    // Peak-hour protection "avoid" mode: deprioritize (never exclude) an
    // active-window connection when a non-windowed alternative exists.
    if (availableConnections.length > 1) {
      const avoidNow = new Set(
        availableConnections.
        filter((c) => {
          const state = evaluatePeakHourProtection(c.providerSpecificData, new Date(selectionNow));
          return state.active && state.mode === "avoid";
        }).
        map((c) => c.id)
      );
      if (avoidNow.size > 0 && avoidNow.size < availableConnections.length) {
        availableConnections = [
        ...availableConnections.filter((c) => !avoidNow.has(c.id)),
        ...availableConnections.filter((c) => avoidNow.has(c.id))];

      }
    }

    // #2024: with several Ollama nodes configured, a request for one model may
    // only reach the nodes whose discovered catalog lists it. A node whose
    // catalog is unknown stays eligible, behind the confirmed ones. When no
    // node confirms the model, the selection order is left untouched so
    // routing keeps today's behaviour.
    if (providerId === OLLAMA_LOCAL_PROVIDER_ID && model) {
      availableConnections = await rankOllamaConnectionsByCatalog(availableConnections, model, {
        signal,
        ttlMs: options?.ollamaCatalogTtlMs,
        loader: options?.ollamaCatalogLoader || null,
      });
    }

    if (model && healthEnabled(providerId, selectionSettings) && !preferredConnectionId && !strictConnectionId) {
      availableConnections = antigravityHealth.candidates(availableConnections, options?.healthModel || model);
      if (!availableConnections.length) return { connectionRecoveryBusy: true };
      if (quotaRankedEligible) quotaRankedEligible = quotaRankedEligible.filter((candidate) => availableConnections.includes(candidate.value));
    }

    let connection;
    // For round-robin, honor existing session affinity before quota ranking so
    // a session that already picked an account stays on it when it remains eligible.
    const stickyConnectionId = sessionId && strategy === "round-robin" ?
    getSessionAffinity(providerId, sessionId) :
    null;
    const stickyConnection = stickyConnectionId ?
    availableConnections.find((c) => c.id === stickyConnectionId) :
    null;
    // Cache-affinity picks a connection ahead of quota ranking too, mirroring
    // round-robin's sticky pin: a conversation that already has an account
    // must keep it (for the provider prompt cache) even when quota fairness
    // would otherwise reorder the pool. No sessionId (e.g. a client that sends
    // none) falls through to fill-first below, same as upstream's contract.
    const cacheAffinityConnection = strategy === "cache-affinity" && sessionId ?
    pickByCacheAffinity(sessionId, availableConnections) :
    null;

    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {

      // skip strategy
    } else if (stickyConnection) {connection = stickyConnection;
      log.debug("AUTH", `${provider} | session-sticky ${sessionId.slice(0, 8)} → ${connection.id?.slice(0, 8)}`);
      connection = (await updateProviderConnection(connection.id, {
        lastUsedAt: new Date().toISOString()
      })) || connection;
    } else if (cacheAffinityConnection) {
      connection = cacheAffinityConnection;
      log.debug("AUTH", `${provider} | cache-affinity ${sessionId.slice(0, 8)} → ${connection.id?.slice(0, 8)}`);
      connection = (await updateProviderConnection(connection.id, {
        lastUsedAt: new Date().toISOString()
      })) || connection;
    } else if (strategy === "earliest-reset") {
      connection = pickEarliestResetConnection(availableConnections, quotaDecisions, selectionNow);
    } else if (quotaRanked) {
      // Persistent pressure + last-selection history provide the fairness tier
      // for quota-comparable accounts. Atomic acquire remains the final arbiter.
      // "quota-weighted" draws probabilistically instead of always taking the
      // top score, so concurrent requests spread across accounts that still
      // have leftover quota instead of herding onto whichever one ranks first.
      connection = strategy === "quota-weighted" && quotaRankedEligible ?
      pickQuotaWeightedConnection(quotaRankedEligible, {
        floorPercent: providerOverride.quotaWeightedFloorPercent ??
        selectionSettings.quotaWeightedFloorPercent ??
        1
      }) || availableConnections[0] :
      availableConnections[0];
    } else if (strategy === "round-robin") {
      // An explicit 0 keeps the current account until it is unavailable (upstream #3259).
      const configuredStickyLimit = providerOverride.stickyRoundRobinLimit ?? selectionSettings.stickyRoundRobinLimit;
      const stickyLimit = configuredStickyLimit === 0 ? Infinity : configuredStickyLimit || 3;

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
        connection = (await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        })) || connection;
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
          connection = (await updateProviderConnection(connection.id, {
            lastUsedAt: new Date().toISOString(),
            consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
          })) || connection;
        } else {
          connection = pickOldest();

          // Update lastUsedAt and reset count to 1 (await to ensure persistence)
          connection = (await updateProviderConnection(connection.id, {
            lastUsedAt: new Date().toISOString(),
            consecutiveUseCount: 1
          })) || connection;
        }
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections).
      // Also the fallback for cache-affinity when the request carries no sessionId.
      connection = availableConnections[0];
    }

    if (connection && strategy === "round-robin" && sessionId) {
      rememberSessionAffinity(providerId, sessionId, connection.id);
    }

    throwIfAborted(signal);
    const credentials = await projectProviderCredentials(connection, quotaDecisions.get(connection.id) || null);
    recordConnectionUsage(connection, rpmLimit, selectionNow);
    return credentials;
  } finally {
    if (!releaseAfterPredecessor && resolveMutex) resolveMutex();
  }
}

/**
 * Resolve a handler's explicit no-auth branch through the same provider-account
 * selector used by credentialed requests. A scoped key may use a stored
 * connection for this provider, but cannot fall back to anonymous/local
 * execution. Zero relation rows preserve the legacy direct path, except for
 * NO_AUTH_CONNECTION_HOST_PROVIDERS (local-whisper, firecrawl_custom) with an active row, which
 * take normal selection so the saved row's credentials are used.
 *
 * Synthetic selector credentials are normalized back to an empty object so
 * no public token or proxy metadata leaks into cores that historically ran
 * without credentials; stored connection projections are preserved.
 */
export async function getNoAuthProviderCredentials(provider, model = null, options = {}) {
  const credentials = await getProviderCredentials(provider, null, model, {
    ...options,
    noAuthPath: true,
  });
  return credentials?.connectionId === "noauth" ? {} : credentials;
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
 * exhausted — re-calls the plain selector with a cloned exclusions set for a
 * scoped request. That set starts with caller exclusions and adds every
 * connection id that received a definitive denial during this call. The
 * refresh also persists authoritative snapshots, so a future request's own
 * quota inspection natively skips the exhausted account too; scoped reselect
 * never re-picks a denied id even if its persisted write is not yet visible to
 * the read the selector performs. Unscoped requests retain their established
 * fail-open reselect behavior when repository visibility lags the tracker.
 * Fallback shape (allRateLimited / retry metadata) mirrors the plain
 * selector's own contract.
 *
 * Fail-open semantics preserve every existing fallback: a refresh that
 * throws, is unsupported, or resolves with no usable result leaves the
 * original credentials untouched; `null` / `allRateLimited` results pass
 * through unchanged; AbortError always propagates. A connection is refreshed
 * at most once per call, so a stale/repository-mismatched loader cannot loop
 * the same account forever; scoped denials are also excluded from every later
 * reselect in that request.
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
  const selectionNow = options?.now ?? Date.now();
  const quotaRefresher = options?.quotaRefresher || refreshProviderQuota;
  const resourceKeys = options?.resourceKeys || buildQuotaResourceKeys({
    provider: providerId,
    modelCandidates: options?.modelCandidates || (model ? [model] : []),
    quotaFamily: options?.quotaFamily || null
  });
  const relationScoped = Boolean(options?.apiKeyId) && (await getApiKeyProviderConnectionIds(options.apiKeyId)).length > 0;
  const enforceDeniedExclusions = relationScoped || (
    Array.isArray(options?.allowedConnectionIds) && options.allowedConnectionIds.length > 0
  );
  const refreshedConnectionIds = new Set();
  const reselectExclusions = new Set(excludeConnectionIds instanceof Set ? excludeConnectionIds : excludeConnectionIds ? [excludeConnectionIds] : []);

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

    // Evaluate live snapshots on the same clock as selection. Callers that
    // inject `options.now` also construct/persist quota observations against
    // that clock; mixing in wall time can make a fresh denial look stale.
    const decision = evaluateProviderQuotaPreflight(refreshResult.snapshots, {
      connectionId,
      provider: providerId,
      resourceKeys,
      now: selectionNow,
      refreshSupported: true
    });
    if (!decision?.skip) {
      // Upstream says the account is usable — return it with fresh tokens.
      return reloadFreshProjection();
    }

    // A scoped request has an explicit capability boundary. Exclude a
    // definitive denial for its current reselect so delayed persistence cannot
    // re-pick it. Unscoped callers retain established fail-open behavior when
    // repository visibility lags the quota tracker.
    log.info("AUTH", `${provider} | quota preflight blocked ${String(connectionId).slice(0, 8)} (reason=${decision.reason || "unknown"}); reselecting`);
    if (enforceDeniedExclusions) reselectExclusions.add(connectionId);
    credentials = await getProviderCredentials(
      provider,
      enforceDeniedExclusions ? reselectExclusions : excludeConnectionIds,
      model,
      options
    );
    if (!credentials && enforceDeniedExclusions) {
      const retryAfter = decision.retryAt || null;
      return {
        allRateLimited: true,
        retryAfter,
        retryAfterHuman: retryAfter ? formatRetryAfter(retryAfter, selectionNow) : "",
        lastError: "Rate limited",
        lastErrorCode: 429
      };
    }
  }
}

export { markAccountUnavailable, clearAccountError } from "./auth/accountErrors.js";


export { hasValidCliToken, extractApiKey, extractApiKeyCandidates, resolveClientApiKey, isValidApiKey, evaluateApiKeyAuth } from "./auth/clientApiKeys.js";
export { normalizeOllamaModelId, ollamaCatalogServesModel, rankOllamaConnectionsByCatalog } from "./auth/ollamaRouting.js";
export { isProviderConnectionModelLocked } from "./auth/connectionLocks.js";
