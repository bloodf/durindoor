import {
  getRefreshLeadMs,
  isUnrecoverableRefreshError,
  refreshTokenByProvider } from
"./tokenRefresh.js";
import { proxyRouteFingerprint } from "./tokenRefresh/dedup.js";
import { serializeRefresh } from "./refreshSerializer.js";
import { PROVIDER_OAUTH } from "../providers/index.js";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { digestMemoryKey } from "../utils/memoryKey.js";

// Single source: codex.oauth.maxRefreshAgeMs (8 days) — proactive refresh window
import { isNumber, isObject } from "../../src/shared/utils/typeChecks.js";export const CODEX_MAX_REFRESH_AGE_MS = PROVIDER_OAUTH["codex"]?.maxRefreshAgeMs;

const refreshLocks = new Map();

function deleteRefreshLock(key, expectedEntry = null) {
  const current = refreshLocks.get(key);
  if (!current || expectedEntry && current !== expectedEntry) return false;
  if (current.timer) clearTimeout(current.timer);
  refreshLocks.delete(key);
  return true;
}

function pruneRefreshLocks(now = Date.now()) {
  for (const [key, entry] of refreshLocks) {
    if (entry.expiresAt <= now) deleteRefreshLock(key, entry);
  }
}

function makeRoomForRefreshLock() {
  pruneRefreshLocks();
  while (refreshLocks.size >= MEMORY_CONFIG.refreshDedupMaxSize) {
    const oldestKey = refreshLocks.keys().next().value;
    if (oldestKey === undefined) break;
    deleteRefreshLock(oldestKey);
  }
}

function parseTimeMs(value) {
  if (value === undefined || value === null || value === "") return null;
  if (isNumber(value)) {
    return value < 1e12 ? value * 1000 : value;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toExpiresAt(expiresIn, nowMs = Date.now()) {
  if (!expiresIn) return null;
  return new Date(nowMs + expiresIn * 1000).toISOString();
}

export function getCredentialExpiryMs(credentials) {
  return parseTimeMs(credentials?.expiresAt ?? credentials?.tokenExpiresAt);
}

export function getCredentialLastRefreshMs(credentials) {
  return parseTimeMs(
    credentials?.lastRefreshAt ??
    credentials?.lastRefresh ??
    credentials?.providerSpecificData?.lastRefreshAt
  );
}

export function isCodexRefreshStale(credentials, nowMs = Date.now(), maxAgeMs = CODEX_MAX_REFRESH_AGE_MS) {
  const lastRefreshMs = getCredentialLastRefreshMs(credentials);
  return !lastRefreshMs || nowMs - lastRefreshMs >= maxAgeMs;
}

export function shouldRefreshCredentials(provider, credentials, nowMs = Date.now()) {
  if (!credentials) return false;

  const expiresAtMs = getCredentialExpiryMs(credentials);
  if (expiresAtMs !== null && expiresAtMs - nowMs < getRefreshLeadMs(provider)) {
    return true;
  }

  // Proactive stale refresh for providers declaring oauth.maxRefreshAgeMs (e.g. codex)
  const maxAgeMs = PROVIDER_OAUTH[provider]?.maxRefreshAgeMs;
  if (maxAgeMs && credentials.refreshToken && isCodexRefreshStale(credentials, nowMs, maxAgeMs)) {
    return true;
  }

  return false;
}

export function mergeProviderSpecificData(existing, next) {
  if (!next || !isObject(next)) return existing;
  return {
    ...(existing || {}),
    ...next
  };
}

export function mergeRefreshedCredentials(provider, currentCredentials, refreshedCredentials, nowMs = Date.now()) {
  if (!refreshedCredentials) return null;
  if (isUnrecoverableRefreshError(refreshedCredentials)) return refreshedCredentials;

  const next = {};
  const nowIso = new Date(nowMs).toISOString();

  if (refreshedCredentials.accessToken) next.accessToken = refreshedCredentials.accessToken;
  if (refreshedCredentials.apiKey) next.apiKey = refreshedCredentials.apiKey;
  if (refreshedCredentials.token) next.token = refreshedCredentials.token;

  const refreshToken = refreshedCredentials.refreshToken ?? currentCredentials?.refreshToken;
  if (refreshToken) next.refreshToken = refreshToken;

  const idToken = refreshedCredentials.idToken ?? currentCredentials?.idToken;
  if (idToken) next.idToken = idToken;

  if (refreshedCredentials.expiresIn) {
    next.expiresIn = refreshedCredentials.expiresIn;
    next.expiresAt = toExpiresAt(refreshedCredentials.expiresIn, nowMs);
  } else if (refreshedCredentials.expiresAt) {
    next.expiresAt = refreshedCredentials.expiresAt;
  }

  if (refreshedCredentials.projectId) next.projectId = refreshedCredentials.projectId;

  if (refreshedCredentials.providerSpecificData) {
    next.providerSpecificData = mergeProviderSpecificData(
      currentCredentials?.providerSpecificData,
      refreshedCredentials.providerSpecificData
    );
  }

  if (refreshedCredentials.copilotToken) next.copilotToken = refreshedCredentials.copilotToken;
  if (refreshedCredentials.copilotTokenExpiresAt) {
    next.copilotTokenExpiresAt = refreshedCredentials.copilotTokenExpiresAt;
  }

  // trackRefreshAt providers (e.g. codex) always stamp lastRefreshAt for staleness tracking
  if (
  PROVIDER_OAUTH[provider]?.trackRefreshAt ||
  next.accessToken ||
  next.apiKey ||
  next.token ||
  next.refreshToken ||
  next.copilotToken)
  {
    next.lastRefreshAt = refreshedCredentials.lastRefreshAt || nowIso;
  }

  return next;
}

/**
 * Reconstruct the immutable OAuth egress contract from persisted credentials,
 * then merge any request-local resolved pool fields supplied by the caller.
 *
 * Persisted `oauthProxy.mode` remains authoritative for the fail-open/fail-closed
 * policy. Resolved URLs stay request-local and are never written by this helper.
 *
 * @param {object|null} credentials Provider credentials.
 * @param {object|null} explicitProxyOptions Resolved request-local routing.
 * @returns {object} Effective proxy options for refresh and retry.
 */
export function resolveCredentialProxyOptions(credentials, explicitProxyOptions = null) {
  const data = credentials?.providerSpecificData || {};
  const oauthProxy = data.oauthProxy && isObject(data.oauthProxy) ?
  data.oauthProxy :
  {};
  const explicit = explicitProxyOptions && isObject(explicitProxyOptions) ?
  explicitProxyOptions :
  {};

  const options = {
    oauthProxy,
    proxyMode: oauthProxy.mode || data.proxyMode || "legacy",
    proxyPoolId:
    oauthProxy.poolId ||
    data.proxyPoolId ||
    data.connectionProxyPoolId ||
    null,
    connectionProxyPoolId:
    data.connectionProxyPoolId ||
    data.proxyPoolId ||
    oauthProxy.poolId ||
    null,
    connectionProxyEnabled: data.connectionProxyEnabled === true,
    connectionProxyUrl: data.connectionProxyUrl || "",
    connectionNoProxy: data.connectionNoProxy || "",
    vercelRelayUrl: data.vercelRelayUrl || "",
    strictProxy: data.strictProxy === true,
    disableEnvProxy: data.disableEnvProxy === true,
    ...explicit
  };
  // Persisted metadata is the authority. Request-local options may supply a
  // resolved endpoint but may not replace a stored mode or pool identity.
  if (oauthProxy.mode) options.oauthProxy = oauthProxy;
  options.proxyMode = options.oauthProxy?.mode || options.proxyMode;
  options.proxyPoolId =
  options.oauthProxy?.poolId ||
  options.proxyPoolId ||
  options.connectionProxyPoolId ||
  null;
  options.connectionProxyPoolId =
  options.connectionProxyPoolId ||
  options.proxyPoolId ||
  null;

  // A caller cannot weaken the durable direct/strict-pool contract by omitting
  // or replacing request-local booleans. Legacy mode intentionally remains
  // best-effort and may use environment/configured proxy fallback.
  if (options.proxyMode === "direct") {
    options.proxyPoolId = null;
    options.connectionProxyPoolId = null;
    options.connectionProxyEnabled = false;
    options.connectionProxyUrl = "";
    options.connectionNoProxy = "";
    options.vercelRelayUrl = "";
    options.disableEnvProxy = true;
    options.strictProxy = false;
  } else if (options.proxyMode === "strict-pool") {
    options.disableEnvProxy = true;
    options.strictProxy = true;
  }

  return options;
}

function getRefreshLockKey(provider, credentials, proxyOptions) {
  const stableId =
  credentials?.connectionId ||
  credentials?.id ||
  credentials?.email ||
  credentials?.name ||
  credentials?.refreshToken?.slice?.(-16) ||
  "default";
  return digestMemoryKey(
    "credential-refresh-lock",
    provider,
    stableId,
    proxyRouteFingerprint(proxyOptions)
  );
}

export async function withCredentialRefreshLock(provider, credentials, refreshFn, proxyOptions = null) {
  const key = getRefreshLockKey(provider, credentials, proxyOptions);
  const existing = refreshLocks.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;
  if (existing) deleteRefreshLock(key, existing);

  makeRoomForRefreshLock();
  const entry = { promise: null, expiresAt: Date.now() + MEMORY_CONFIG.refreshDedupInFlightTtlMs, timer: null };

  const pending = Promise.resolve().
  then(refreshFn).
  finally(() => {
    deleteRefreshLock(key, entry);
  });

  entry.promise = pending;
  refreshLocks.set(key, entry);
  entry.timer = setTimeout(() => {
    deleteRefreshLock(key, entry);
  }, MEMORY_CONFIG.refreshDedupInFlightTtlMs);
  entry.timer.unref?.();
  return pending;
}

export function __getCredentialRefreshLockSnapshotForTesting() {
  return {
    keys: [...refreshLocks.keys()],
    size: refreshLocks.size,
    maxSize: MEMORY_CONFIG.refreshDedupMaxSize,
    ttlMs: MEMORY_CONFIG.refreshDedupInFlightTtlMs
  };
}

export function __clearCredentialRefreshLocksForTesting() {
  for (const [key, entry] of refreshLocks) deleteRefreshLock(key, entry);
}

/**
 * Refresh and merge provider credentials without changing the request's egress
 * route. The optional trailing proxy context is used by reactive 401/403 paths;
 * proactive paths reconstruct it from the selected connection credentials.
 */
export async function refreshProviderCredentials(provider, credentials, log, proxyOptions = null) {
  if (!credentials) return null;
  const effectiveProxyOptions = resolveCredentialProxyOptions(credentials, proxyOptions);

  return withCredentialRefreshLock(provider, credentials, async () => {
    // Serialize the network refresh across every connection in the same
    // rotation group (e.g. Codex + openai share one Auth0 client_id; all Claude
    // accounts share the anthropic-oauth family). Two sibling accounts must
    // never POST to /oauth/token concurrently, or Auth0/Anthropic refresh_token
    // family revocation bricks the losers. The per-token withCredentialRefreshLock
    // dedup above cannot see cross-account collisions; non-rotating providers
    // pass straight through serializeRefresh with no locking.
    const refreshed = await serializeRefresh(provider, () =>
    refreshTokenByProvider(
      provider,
      credentials,
      log,
      effectiveProxyOptions
    )
    );
    return mergeRefreshedCredentials(provider, credentials, refreshed);
  }, effectiveProxyOptions);
}