/**
 * Microsoft 365 Copilot refresh-token renewal.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/services/tokenRefresh/providers/m365.ts`
 * and `refreshM365AccessToken` in `copilot-m365-connection.ts` at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
 *
 * Each connection refreshes with its own refresh token, against its own tenant. Microsoft rotates
 * the refresh token on use, so the rotated one is returned for the caller to persist; refreshes
 * are de-duplicated per (refresh token, egress route), never across connections.
 */
import { M365_OAUTH_SCOPE, getM365ClientId, m365TokenUrl } from "../../config/copilotM365.js";
import { credentialFetch } from "../../utils/credentialFetch.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { sanitizeErrorMessage } from "../../utils/error.js";
import { m365RefreshTenant } from "../../utils/m365Identity.js";
import { dedupRefresh } from "./dedup.js";
import { isNumber, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

export const M365_REFRESH_TIMEOUT_MS = 30_000;
export const M365_CLIENT_CONFIG_REFRESH_MAX_ATTEMPTS = 3;
export const M365_CLIENT_CONFIG_REFRESH_COOLDOWN_MS = 30 * 60 * 1000;
const clientConfigRefreshFailures = new Map();
export function resetM365RefreshCircuit(connectionId) {
  if (isString(connectionId) && connectionId) clientConfigRefreshFailures.delete(connectionId);
}
// Microsoft rejects a refresh grant with these codes when the grant itself is dead.
const PERMANENT_CODES = new Set(["invalid_grant", "invalid_token", "expired_token", "access_denied"]);

async function readTokenBody(response) {
  try {
    const body = await response.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

/**
 * Redeem `refreshToken` at the tenant's token endpoint. Returns `{ accessToken, refreshToken,
 * expiresIn }`, `{ error: "unrecoverable_refresh_error", code }` when the grant is dead, or null
 * for a transient failure (network, throttling, a tenant that rejects the client).
 */
export async function refreshM365Token(credentials, log, proxyOptions = null) {
  const refreshToken = credentials?.refreshToken;
  if (!isString(refreshToken) || !refreshToken) return null;
  const tenant = m365RefreshTenant(credentials);
  if (tenant === null) return { error: "unrecoverable_refresh_error", code: "invalid_tenant" };
  const connectionId = credentials?.connectionId;
  const breaker = isString(connectionId) && connectionId ? clientConfigRefreshFailures.get(connectionId) : null;
  if (breaker && breaker.until > Date.now()) return { error: "unrecoverable_refresh_error", code: "unauthorized_client" };
  if (breaker?.until > 0 && breaker.until <= Date.now()) clientConfigRefreshFailures.delete(connectionId);
  return dedupRefresh("copilot-m365-web", refreshToken, async () => {
    try {
      const fetcher = (url, init) => proxyAwareFetch(url, init, proxyOptions);
      const response = await credentialFetch(fetcher, m365TokenUrl(tenant), {
        method: "POST",
        signal: AbortSignal.timeout(M365_REFRESH_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          client_id: getM365ClientId(),
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: M365_OAUTH_SCOPE
        })
      });
      const body = await readTokenBody(response);
      if (!response.ok || !isString(body.access_token) || !body.access_token) {
        // Only the OAuth error code is read; the description can carry credentials.
        const code = isString(body.error) ? body.error : "m365_refresh_failed";
        log?.warn?.("TOKEN_REFRESH", sanitizeErrorMessage(`M365 refresh rejected: ${code}`));
        if (code === "unauthorized_client" && connectionId) {
          const failures = (clientConfigRefreshFailures.get(connectionId)?.failures || 0) + 1;
          if (failures >= M365_CLIENT_CONFIG_REFRESH_MAX_ATTEMPTS) {
            clientConfigRefreshFailures.set(connectionId, { failures, until: Date.now() + M365_CLIENT_CONFIG_REFRESH_COOLDOWN_MS });
          } else clientConfigRefreshFailures.set(connectionId, { failures, until: 0 });
          return failures >= M365_CLIENT_CONFIG_REFRESH_MAX_ATTEMPTS ? { error: "unrecoverable_refresh_error", code } : null;
        }
        return PERMANENT_CODES.has(code) ? { error: "unrecoverable_refresh_error", code } : null;
      }
      log?.info?.("TOKEN_REFRESH", "M365 access token refreshed");
      const expiresIn = isNumber(body.expires_in) && body.expires_in > 0 && body.expires_in <= 31_536_000 ?
      body.expires_in :
      undefined;
      return {
        accessToken: body.access_token,
        refreshToken: isString(body.refresh_token) && body.refresh_token ? body.refresh_token : refreshToken,
        ...(isString(body.id_token) && body.id_token ? { idToken: body.id_token } : null),
        ...(expiresIn ? { expiresIn } : null)
      };
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", sanitizeErrorMessage(`M365 refresh failed: ${error?.code || error?.name || "error"}`));
      return null;
    }
  }, log, proxyOptions);
}

export function __resetM365RefreshCircuitsForTesting() { clientConfigRefreshFailures.clear(); }

/**
 * Mint an access token for another `scope` (the Designer artifact service) from a connection's
 * refresh token, at its own tenant. Returns `{ accessToken, refreshToken, expiresIn }` or
 * `{ error }`. De-duplicated per refresh token and scope, separately from the chat refresh, so the
 * two never hand each other a token for the wrong audience. Ported from OmniRoute
 * `refreshM365ScopedToken` (MIT) at 5ffa68e83544.
 */
export async function mintM365ScopedToken(credentials, scope, { signal, proxyOptions = null, log } = {}) {
  const refreshToken = credentials?.refreshToken;
  if (!isString(refreshToken) || !refreshToken) return { error: "missing_refresh_token" };
  const tenant = m365RefreshTenant(credentials);
  if (tenant === null) return { error: "invalid_tenant" };
  const dedupKey = `copilot-m365-web:${scope}`;
  return dedupRefresh(dedupKey, refreshToken, async () => {
    try {
      const timeout = AbortSignal.timeout(M365_REFRESH_TIMEOUT_MS);
      const fetcher = (url, init) => proxyAwareFetch(url, init, proxyOptions);
      const response = await credentialFetch(fetcher, m365TokenUrl(tenant), {
        method: "POST",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: getM365ClientId(),
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope
        })
      });
      const body = await readTokenBody(response);
      if (!response.ok || !isString(body.access_token) || !body.access_token) {
        const code = isString(body.error) ? body.error : "m365_scoped_token_failed";
        log?.warn?.("TOKEN_REFRESH", sanitizeErrorMessage(`M365 scoped token rejected: ${code}`));
        return { error: code };
      }
      const expiresIn = isNumber(body.expires_in) && body.expires_in > 0 && body.expires_in <= 31_536_000 ?
      body.expires_in :
      undefined;
      return {
        accessToken: body.access_token,
        refreshToken: isString(body.refresh_token) && body.refresh_token ? body.refresh_token : refreshToken,
        ...(expiresIn ? { expiresIn } : null)
      };
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", sanitizeErrorMessage(`M365 scoped token failed: ${error?.code || error?.name || "error"}`));
      return { error: "m365_scoped_token_failed" };
    }
  }, log, proxyOptions);
}
