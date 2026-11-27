// Re-export from open-sse with local logger
import * as log from "../utils/logger.js";
import { updateProviderConnection } from "../../lib/localDb.js";
import { isNumber, isRecord, isString } from "../../shared/utils/typeChecks.js";
import {
  getProjectIdForConnection,
  removeConnection } from
"open-sse/services/projectId.js";
import {
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
  isUnrecoverableRefreshError,
  refreshAccessToken as _refreshAccessToken,
  refreshClaudeOAuthToken as _refreshClaudeOAuthToken,
  refreshGoogleToken as _refreshGoogleToken,
  refreshQwenToken as _refreshQwenToken,
  refreshCodexToken as _refreshCodexToken,
  refreshIflowToken as _refreshIflowToken,
  refreshGitHubToken as _refreshGitHubToken,
  refreshCopilotToken as _refreshCopilotToken,
  getAccessToken as _getAccessToken,
  refreshTokenByProvider as _refreshTokenByProvider,
  refreshKiroToken as _refreshKiroToken,
  getRefreshLeadMs as _getRefreshLeadMs } from
"open-sse/services/tokenRefresh.js";
import {
  expiryFromLifetime,
  toIsoTime,
  refreshProviderCredentials as _refreshProviderCredentials,
  resolveCredentialProxyOptions as _resolveCredentialProxyOptions,
  shouldRefreshCredentials as _shouldRefreshCredentials } from
"open-sse/services/oauthCredentialManager.js";
import { refreshCapabilities } from "open-sse/services/tokenRefresh/capabilities.js";
import { hasCodexIdentityClaims } from "open-sse/services/usage/codexCredentialBinding.js";
import { providerRefreshContext } from "../../shared/utils/providerCredentialContext.js";

export const TOKEN_EXPIRY_BUFFER_MS = BUFFER_MS;

// ─── Re-exports wrapped with local logger ─────────────────────────────────────

export const refreshAccessToken = (provider, refreshToken, credentials, proxyOptions = null) =>
_refreshAccessToken(provider, refreshToken, credentials, log, proxyOptions);

export const refreshClaudeOAuthToken = (refreshToken, proxyOptions = null) =>
_refreshClaudeOAuthToken(refreshToken, log, proxyOptions);

export const refreshGoogleToken = (refreshToken, clientId, clientSecret, proxyOptions = null) =>
_refreshGoogleToken(refreshToken, clientId, clientSecret, log, proxyOptions);

export const refreshQwenToken = (refreshToken, proxyOptions = null) =>
_refreshQwenToken(refreshToken, log, proxyOptions);

export const refreshCodexToken = (refreshToken, proxyOptions = null) =>
_refreshCodexToken(refreshToken, log, proxyOptions);

export const refreshIflowToken = (refreshToken, proxyOptions = null) =>
_refreshIflowToken(refreshToken, log, proxyOptions);

export const refreshGitHubToken = (refreshToken, proxyOptions = null) =>
_refreshGitHubToken(refreshToken, log, proxyOptions);

export const refreshCopilotToken = (githubAccessToken, proxyOptions = null) =>
_refreshCopilotToken(githubAccessToken, log, proxyOptions);

export const refreshKiroToken = (refreshToken, providerSpecificData, proxyOptions = null) =>
_refreshKiroToken(refreshToken, providerSpecificData, log, proxyOptions);

export const getAccessToken = (provider, credentials, proxyOptions = null) =>
_getAccessToken(provider, credentials, log, proxyOptions);

export const refreshTokenByProvider = (provider, credentials, proxyOptions = null) =>
_refreshTokenByProvider(provider, credentials, log, proxyOptions);

export const shouldRefreshCredentials = (provider, credentials) =>
_shouldRefreshCredentials(provider, credentials);

// ─── Lifecycle hook ───────────────────────────────────────────────────────────

/**
 * Call this when a connection is fully closed / removed.
 * Aborts any in-flight projectId fetch and evicts its cache entry,
 * preventing the module-level Maps from accumulating stale entries.
 *
 * @param {string} connectionId
 */
export function releaseConnection(connectionId) {
  if (!connectionId) return;
  removeConnection(connectionId);
  log.debug("TOKEN_REFRESH", "Released connection resources", { connectionId });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const MAX_REFRESH_SECRET_LENGTH = 64 * 1024;

/** A refresh secret that is safe to store and to send back in a header. */
function isStorableSecret(value) {
  return isString(value) && value.trim() !== "" &&
  value.length <= MAX_REFRESH_SECRET_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

/** A finite, positive time (epoch number or parseable timestamp string). */
function isPositiveTime(value) {
  if (isNumber(value)) return Number.isFinite(value) && value > 0;
  return isString(value) && value.trim() !== "" && Number.isFinite(new Date(value).getTime()) &&
  new Date(value).getTime() > 0;
}

/** Copy of provider data without malformed Copilot token or expiry fields. */
function withoutMalformedCopilotFields(data) {
  if (!isRecord(data)) return null;
  const { copilotToken, copilotTokenExpiresAt, ...rest } = data;
  return {
    ...rest,
    ...(isStorableSecret(copilotToken) ? { copilotToken } : null),
    ...(isPositiveTime(copilotTokenExpiresAt) ? { copilotTokenExpiresAt } : null)
  };
}

/**
 * Non-blocking: fetch and persist a missing project ID after token refresh.
 * Stored project IDs survive access-token rotation because Google binds them
 * to the account rather than the short-lived access token.
 *
 * @param {string} provider
 * @param {string} connectionId
 * @param {string} accessToken
 * @param {object|null} proxyOptions
 */
function _refreshProjectId(provider, connectionId, accessToken, proxyOptions) {
  if (!refreshCapabilities(provider).googleProjectId || !connectionId || !accessToken) return;

  // Lazy resolution: do not eagerly trigger onboardUser during background token refresh.
  // Eagerly fetching projectId across multiple accounts simultaneously triggers
  // Google Cloud anti-abuse / rate limits. Runtime handlers (e.g. chat handler)
  // lazily call getProjectIdForConnection() on demand.
  // NOTE(fork divergence): unlike upstream we do NOT invalidateProjectId() here —
  // port #3452 retains valid provider project IDs across access-token rotation.
  if (process.env.EAGER_PROJECT_ID_REFRESH === "true") {
    getProjectIdForConnection(connectionId, accessToken, proxyOptions, null, provider).
    then((projectId) => {
      if (!projectId) return;
      updateProviderCredentials(connectionId, { projectId }).catch((err) => {
        log.debug("TOKEN_REFRESH", "Failed to persist refreshed projectId", {
          connectionId,
          error: err?.message ?? err
        });
      });
    }).
    catch((err) => {
      log.debug("TOKEN_REFRESH", "Failed to fetch projectId after token refresh", {
        connectionId,
        error: err?.message ?? err
      });
    });
  }
}

// ─── Local-specific: persist credentials to localDb ──────────────────────────

/**
 * Persist updated credentials for a connection to localDb.
 * Only fields that are present in `newCredentials` are written. Malformed
 * tokens and times are skipped so the valid fields beside them still persist.
 *
 * @param {string} connectionId
 * @param {object} newCredentials
 * @param {object} [options]
 * @param {object} [options.expectedRefreshContext] Sending credentials for guarded rotation
 * @param {string} [options.presentedRefreshToken] Refresh token sent to the provider.
 *   The write is refused when the stored token is neither this one nor its replacement.
 * @param {string} [options.presentedAccessToken] Access token at refresh start, when available.
 * @returns {Promise<boolean>}
 */
export async function updateProviderCredentials(connectionId, newCredentials, { expectedRefreshContext, presentedRefreshToken, presentedAccessToken } = {}) {
  const rotatedApiKey = newCredentials?.rotatedApiKey;
  try {
    // Persist only the cookie, and only while the sending session is current.
    if (isString(rotatedApiKey) && rotatedApiKey) {
      if (expectedRefreshContext?.authType !== "cookie" ||
          expectedRefreshContext.id !== connectionId || !expectedRefreshContext.apiKey) return false;
      const result = await updateProviderConnection(connectionId, { apiKey: rotatedApiKey }, {
        expectedRefreshContext,
        returnCommitResult: true
      });
      return result?.applied === true;
    }

    const updates = {};

    for (const field of ["accessToken", "refreshToken", "idToken"]) {
      if (isStorableSecret(newCredentials[field])) updates[field] = newCredentials[field];
    }
    const lastRefreshAt = toIsoTime(newCredentials.lastRefreshAt);
    if (lastRefreshAt) updates.lastRefreshAt = lastRefreshAt;
    const lifetimeExpiresAt = expiryFromLifetime(newCredentials.expiresIn);
    if (lifetimeExpiresAt) {
      updates.expiresAt = lifetimeExpiresAt;
      updates.expiresIn = newCredentials.expiresIn;
    } else {
      const expiresAt = toIsoTime(newCredentials.expiresAt);
      if (expiresAt) {
        updates.expiresAt = expiresAt;
        updates.expiresIn = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      }
    }
    const providerSpecificData = withoutMalformedCopilotFields(newCredentials.providerSpecificData);
    if (providerSpecificData) {
      updates.providerSpecificData = {
        ...(newCredentials.existingProviderSpecificData || {}),
        ...providerSpecificData
      };
    }
    const copilotToken = isStorableSecret(newCredentials.copilotToken) ? newCredentials.copilotToken : null;
    const copilotTokenExpiresAt = isPositiveTime(newCredentials.copilotTokenExpiresAt) ?
    newCredentials.copilotTokenExpiresAt : null;
    if (copilotToken || copilotTokenExpiresAt) {
      updates.providerSpecificData = {
        ...(updates.providerSpecificData || newCredentials.existingProviderSpecificData || {}),
        ...(copilotToken ? { copilotToken } : null),
        ...(copilotTokenExpiresAt ? { copilotTokenExpiresAt } : null)
      };
    }
    if (newCredentials.projectId) updates.projectId = newCredentials.projectId;
    let guard = null;
    if (expectedRefreshContext) {
      guard = { expectedRefreshContext };
    } else if (presentedRefreshToken) {
      // An unchanged refresh token must not let a stale access token overwrite a winner.
      guard = {
        shouldCommitConnection: (stored) => (stored.refreshToken === presentedRefreshToken ||
        Boolean(updates.refreshToken) && stored.refreshToken === updates.refreshToken) &&
        (!isStorableSecret(presentedAccessToken) || !isStorableSecret(stored.accessToken) ||
          stored.accessToken === presentedAccessToken)
      };
    }
    // The repo compares rotated identity claims with the stored row under its write lock.
    if (hasCodexIdentityClaims(updates)) guard = { ...guard, refreshRotation: true };
    const result = guard ?
    await updateProviderConnection(connectionId, updates, { ...guard, returnCommitResult: true }) :
    await updateProviderConnection(connectionId, updates);
    const applied = guard ? result?.applied === true : !!result;
    log.info("TOKEN_REFRESH", "Credentials updated in localDb", {
      connectionId,
      success: applied
    });
    return applied;
  } catch (error) {
    const details = { connectionId };
    if (!rotatedApiKey) details.error = error.message;
    log.error("TOKEN_REFRESH", "Error updating credentials in localDb", details);
    return false;
  }
}

// ─── Local-specific: proactive token refresh ─────────────────────────────────

/**
 * Check whether the provider token (and, for GitHub, the Copilot token) is
 * about to expire and refresh it proactively.
 *
 * @param {string} provider
 * @param {object} credentials
 * @param {object|null} [proxyOptions]
 * @param {{ force?: boolean }} [options] force=true skips the on-request lead
 *   check. The background scheduler passes it because it applies its own,
 *   larger lead; the request path never does.
 * @returns {Promise<object>} updated credentials object
 */
export async function checkAndRefreshToken(provider, credentials, proxyOptions = null, options = {}) {
  let creds = { ...credentials };
  if (!creds.connectionId && creds.id) {
    creds.connectionId = creds.id;
  }
  const effectiveProxyOptions = _resolveCredentialProxyOptions(creds, proxyOptions);
  const force = options?.force === true;
  // CAS fingerprint of the credentials we are about to present. Matches the
  // request-path guard in refreshAndUpdateCredentials so a concurrent winner
  // that already rotated is not overwritten with reauth_required.
  const expectedRefreshContext = providerRefreshContext(
    provider === "codex" && credentials._connection ? { ...credentials._connection, ...credentials } : credentials
  );

  // ── 1. Regular access-token expiry ────────────────────────────────────────
  if (force || _shouldRefreshCredentials(provider, creds)) {
    const expiresAt = creds.expiresAt ? new Date(creds.expiresAt).getTime() : null;
    const remaining = expiresAt ? expiresAt - Date.now() : null;
    const refreshLead = _getRefreshLeadMs(provider, creds.providerSpecificData);

    log.info("TOKEN_REFRESH", "Refreshing provider credentials proactively", {
      provider,
      expiresIn: remaining === null ? null : Math.round(remaining / 1000),
      refreshLeadMs: refreshLead,
      lastRefreshAt: creds.lastRefreshAt || null
    });

    const presentedRefreshToken = creds.refreshToken;
    const newCreds = await _refreshProviderCredentials(provider, creds, log, effectiveProxyOptions);

    // Background force-refresh used to drop unrecoverable results silently,
    // leaving the row "active" after refresh_token_reused / invalid_grant
    // (durindoor#2280). Pin the same durable reauth_required state the request
    // path writes, then surface the error (the tick swallows it).
    if (isUnrecoverableRefreshError(newCreds)) {
      if (creds.connectionId) {
        try {
          await updateProviderConnection(
            creds.connectionId,
            {
              testStatus: "reauth_required",
              lastError: "OAuth session expired. Reconnect this account.",
              errorCode: "REAUTH",
              lastErrorAt: new Date().toISOString()
            },
            { expectedRefreshContext }
          );
        } catch (persistErr) {
          log.warn("TOKEN_REFRESH", "Failed to pin reauth_required after unrecoverable refresh", {
            connectionId: creds.connectionId,
            error: persistErr?.message ?? String(persistErr)
          });
        }
      }
      const err = new Error("Failed to refresh credentials. Please re-authorize the connection.");
      err.code = "PROVIDER_REAUTH_REQUIRED";
      throw err;
    }

    if (newCreds?.accessToken || newCreds?.apiKey || newCreds?.copilotToken) {
      const mergedCreds = {
        ...newCreds,
        // Persist saved configuration, not proxy values resolved for this request.
        existingProviderSpecificData: creds._connection?.providerSpecificData || creds.providerSpecificData
      };

      // Persist to DB (non-blocking path continues below)
      const guardedCodex = provider === "codex" && expectedRefreshContext.provider === "codex";
      const applied = newCreds.rotationCommitted === true ? true : await updateProviderCredentials(creds.connectionId, mergedCreds,
        guardedCodex ? { expectedRefreshContext } : { presentedRefreshToken, presentedAccessToken: credentials.accessToken });
      // Never dispatch a Codex token whose identity the store did not accept.
      if (!applied && (guardedCodex || provider === "codex" && hasCodexIdentityClaims(newCreds))) return creds;

      creds = {
        ...creds,
        ...newCreds,
        expiresAt: expiryFromLifetime(newCreds.expiresIn) ||
        toIsoTime(newCreds.expiresAt) || creds.expiresAt,
        providerSpecificData: newCreds.providerSpecificData ?
        { ...creds.providerSpecificData, ...newCreds.providerSpecificData } :
        creds.providerSpecificData
      };

      // Non-blocking: discover only when this connection has no stored project ID.
      if (!creds.projectId && (provider !== "antigravity" && provider !== "agy" ||
          creds.isActive !== false && creds._connection?.isActive !== false)) {
        _refreshProjectId(provider, creds.connectionId, creds.accessToken, effectiveProxyOptions);
      }
    }
  }

  // ── 2. GitHub Copilot token expiry ────────────────────────────────────────
  if (provider === "github") {
    const copilotToken = creds.providerSpecificData?.copilotToken;
    const copilotExpiresAt = creds.providerSpecificData?.copilotTokenExpiresAt ?
    creds.providerSpecificData.copilotTokenExpiresAt * 1000 :
    0;
    const now = Date.now();
    const remaining = copilotExpiresAt - now;

    if (!copilotToken || remaining < TOKEN_EXPIRY_BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Copilot token expiring soon or missing, refreshing proactively", {
        provider,
        expiresIn: copilotToken ? Math.round(remaining / 1000) : "missing"
      });

      const copilotTokenResult = await refreshCopilotToken(creds.accessToken, effectiveProxyOptions);
      if (copilotTokenResult) {
        const updatedSpecific = {
          ...creds.providerSpecificData,
          copilotToken: copilotTokenResult.token,
          copilotTokenExpiresAt: copilotTokenResult.expiresAt
        };

        await updateProviderCredentials(creds.connectionId, {
          providerSpecificData: {
            ...(creds._connection?.providerSpecificData || creds.providerSpecificData),
            copilotToken: copilotTokenResult.token,
            copilotTokenExpiresAt: copilotTokenResult.expiresAt
          }
        });

        creds.providerSpecificData = updatedSpecific;
        creds.copilotToken = copilotTokenResult.token;
      }
    }
  }

  return creds;
}

// ─── Local-specific: combined GitHub + Copilot refresh ───────────────────────

/**
 * Refresh the GitHub OAuth token and immediately exchange it for a fresh
 * Copilot token.
 *
 * @param {object} credentials  – must contain `refreshToken`
 * @returns {Promise<object|null>} merged credentials or the raw GitHub credentials on Copilot failure
 */
export async function refreshGitHubAndCopilotTokens(credentials, proxyOptions = null) {
  const effectiveProxyOptions = _resolveCredentialProxyOptions(credentials, proxyOptions);
  const newGitHubCreds = await refreshGitHubToken(credentials.refreshToken, effectiveProxyOptions);
  if (!newGitHubCreds?.accessToken) return newGitHubCreds;

  const copilotToken = await refreshCopilotToken(newGitHubCreds.accessToken, effectiveProxyOptions);
  if (!copilotToken) return newGitHubCreds;

  return {
    ...newGitHubCreds,
    providerSpecificData: {
      copilotToken: copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expiresAt
    }
  };
}
