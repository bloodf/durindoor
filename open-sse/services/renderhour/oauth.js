// RenderHour subscription sign-in: the token protocol. The OAuth provider map
// (src/lib/oauth/providers.js), the refresh handler table
// (open-sse/services/tokenRefresh.js) and the media credential choice
// (./media.js) use it. See docs/providers/renderhour.md.
//
// Protocol adapted from cheaper-inference/OmniRoute at
// 9671192011beb2d7f83979f40be488c5da8772b9 (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza):
//   - src/lib/oauth/providers/renderhour.ts (authorize URL, code exchange, userinfo, token mapping)
//   - src/lib/oauth/constants/oauth.ts (RENDERHOUR_CONFIG endpoints, S256)
//   - open-sse/services/tokenRefresh/providers/renderhour.ts (rotating refresh, failure codes)
//   - open-sse/config/constants.ts (OAUTH_ENDPOINTS.renderhour)
//   - open-sse/utils/publicCreds.ts (renderhour_id, the public client id)
// The same files are unchanged at release/v3.8.55,
// d3f06ea668109f8ac1feadfcae25f6ff9b873b5f.
//
// What the source states: an authorization code grant with PKCE (S256) for a
// public client (no secret, no scope), a form-encoded token endpoint, a userinfo
// endpoint returning sub/email/name, access tokens (rhat_) that last an hour and
// refresh tokens (rhrt_) that rotate on every refresh, last 30 days and stop
// working once used. Those lifetimes come from the source comments; nothing here
// depends on them except the offline tests.
//
// Fork deviations:
//   - RENDERHOUR_OAUTH_CLIENT_ID overrides the public client (the source has no
//     override). A set but blank or invalid value is a configuration error: no
//     authorize URL, exchange or refresh request is made, and the public client
//     is not substituted.
//   - Fixed endpoints on https://renderhour.com. Redirects are refused, so no
//     code, verifier, refresh token or access token follows a 3xx elsewhere.
//   - Token response bodies are validated; error text from RenderHour is never
//     repeated, only a closed set of OAuth error codes is named.
//   - A refresh response without a new refresh token keeps the stored one
//     (the shared commit only writes explicit replacements).

import { dedupRefresh } from "../tokenRefresh/dedup.js";
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";

export const RENDERHOUR_OAUTH_ORIGIN = "https://renderhour.com";
export const RENDERHOUR_OAUTH_ENDPOINTS = Object.freeze({
  authorize: `${RENDERHOUR_OAUTH_ORIGIN}/oauth/authorize`,
  token: `${RENDERHOUR_OAUTH_ORIGIN}/api/oauth/token`,
  userinfo: `${RENDERHOUR_OAUTH_ORIGIN}/api/oauth/userinfo`,
});
export const RENDERHOUR_CODE_CHALLENGE_METHOD = "S256";
export const RENDERHOUR_CLIENT_ID_ENV = "RENDERHOUR_OAUTH_CLIENT_ID";
// The published PKCE client (no secret) the source ships. Public by design.
export const RENDERHOUR_PUBLIC_CLIENT_ID = "rhc_omniroute";
export const RENDERHOUR_OAUTH_PROVIDER = "renderhour";

// Refresh this long before the stored expiry (same lead as the shared default).
export const RENDERHOUR_REFRESH_LEAD_MS = 5 * 60 * 1000;
export const RENDERHOUR_OAUTH_REQUEST_TIMEOUT_MS = 15_000;

const CLIENT_ID_RE = /^rhc_[A-Za-z0-9_-]{1,64}$/;
const TOKEN_RE = /^[\x21-\x7e]{8,4096}$/;
const MAX_EXPIRES_IN_S = 366 * 24 * 60 * 60;

// Refresh codes that mean the stored refresh token is spent (source list).
const UNRECOVERABLE_REFRESH_CODES = new Set(["invalid_grant", "invalid_token", "token_expired"]);
// OAuth error codes that may be named back to the user. Anything else is "unknown".
const NAMED_ERROR_CODES = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "invalid_token",
  "token_expired",
  "access_denied",
  "server_error",
  "temporarily_unavailable",
]);

/** An error carrying a status and a closed OAuth code; never RenderHour's own text. */
export class RenderHourOAuthError extends Error {
  constructor(message, { code = "unknown", status = 502 } = {}) {
    super(message);
    this.name = "RenderHourOAuthError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The client id for authorize, exchange and refresh. The public client applies
 * only when the override variable is absent. A set override is used when it
 * looks like a RenderHour client id (rhc_…); otherwise the result is null, so
 * the OAuth step fails locally instead of switching to another client.
 */
export function resolveRenderHourClientId(env = process.env) {
  const raw = env?.[RENDERHOUR_CLIENT_ID_ENV];
  if (raw === undefined) return RENDERHOUR_PUBLIC_CLIENT_ID;
  const value = isString(raw) ? raw.trim() : "";
  return CLIENT_ID_RE.test(value) ? value : null;
}

// Static text: the rejected value is never repeated.
const CLIENT_ID_CONFIG_ERROR = `${RENDERHOUR_CLIENT_ID_ENV} is blank or not a RenderHour client id`;

function requireClientId(clientId) {
  if (isString(clientId) && CLIENT_ID_RE.test(clientId)) return clientId;
  throw new RenderHourOAuthError(
    `RenderHour sign-in is misconfigured: ${CLIENT_ID_CONFIG_ERROR}. Remove it to use the default client, or set a valid rhc_ client id.`,
    { code: "not_configured", status: 400 }
  );
}

/** Only absolute http(s) redirect URIs without credentials or fragments are bound. */
export function assertRenderHourRedirectUri(redirectUri) {
  let url;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new RenderHourOAuthError("RenderHour redirect URI is not a valid URL", { code: "invalid_redirect_uri", status: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new RenderHourOAuthError("RenderHour redirect URI is not allowed", { code: "invalid_redirect_uri", status: 400 });
  }
  return redirectUri;
}

/** The authorize URL, exactly the source's parameters: no scope. */
export function buildRenderHourAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }) {
  requireClientId(clientId);
  assertRenderHourRedirectUri(redirectUri);
  if (!isString(state) || state.length < 16) throw new RenderHourOAuthError("RenderHour sign-in needs a state", { code: "invalid_state", status: 400 });
  if (!isString(codeChallenge) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new RenderHourOAuthError("RenderHour sign-in needs an S256 code challenge", { code: "invalid_pkce", status: 400 });
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: RENDERHOUR_CODE_CHALLENGE_METHOD,
    state,
  });
  return `${RENDERHOUR_OAUTH_ENDPOINTS.authorize}?${params.toString()}`;
}

function readErrorCode(text) {
  try {
    const parsed = JSON.parse(text);
    const code = isString(parsed?.error) ? parsed.error : isString(parsed?.error?.code) ? parsed.error.code : null;
    return code && NAMED_ERROR_CODES.has(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * POST or GET a fixed RenderHour OAuth endpoint. Redirects are refused both by
 * fetch (`redirect: "error"`) and by status, so credentials never follow one.
 */
async function oauthFetch(url, init, { fetchImpl = globalThis.fetch, proxyOptions = null, signal = null, timeoutMs = RENDERHOUR_OAUTH_REQUEST_TIMEOUT_MS } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestInit = { ...init, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
  if (proxyOptions) requestInit.proxyOptions = proxyOptions;
  let response;
  try {
    response = await fetchImpl(url, requestInit);
  } catch {
    signal?.throwIfAborted();
    if (timeout.aborted) throw new RenderHourOAuthError("RenderHour sign-in request timed out", { code: "timeout", status: 504 });
    // Transport error text can describe the request body, so it is not repeated.
    throw new RenderHourOAuthError("RenderHour sign-in request failed", { code: "network", status: 502 });
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    void response.body?.cancel?.().catch?.(() => {});
    throw new RenderHourOAuthError("RenderHour sign-in answered with a redirect, which is refused", { code: "redirect_refused", status: 502 });
  }
  return response;
}

async function readJsonObject(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return isObject(body) && !Array.isArray(body) ? body : null;
}

function validToken(value) {
  return isString(value) && TOKEN_RE.test(value) ? value : null;
}

function validExpiresIn(value) {
  const seconds = isString(value) && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : value;
  return isNumber(seconds) && Number.isSafeInteger(seconds) && seconds > 0 && seconds <= MAX_EXPIRES_IN_S ? seconds : null;
}

/** Validate a token endpoint body: access token required, refresh token and expiry optional. */
function parseTokenBody(body) {
  const accessToken = validToken(body?.access_token);
  if (!accessToken) return null;
  const tokenType = isString(body.token_type) && /^bearer$/i.test(body.token_type) ? "Bearer" : null;
  if (body.token_type !== undefined && !tokenType) return null;
  const refreshToken = body.refresh_token === undefined || body.refresh_token === null ? null : validToken(body.refresh_token);
  if (body.refresh_token !== undefined && body.refresh_token !== null && !refreshToken) return null;
  const expiresIn = body.expires_in === undefined || body.expires_in === null ? null : validExpiresIn(body.expires_in);
  if (body.expires_in !== undefined && body.expires_in !== null && expiresIn === null) return null;
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, token_type: tokenType || "Bearer" };
}

/**
 * Exchange an authorization code. Returns the raw-shaped token body
 * ({ access_token, refresh_token, expires_in, token_type }), validated.
 */
export async function exchangeRenderHourCode({ clientId, code, redirectUri, codeVerifier }, options = {}) {
  requireClientId(clientId);
  assertRenderHourRedirectUri(redirectUri);
  if (!isString(code) || !code || code.length > 4096) throw new RenderHourOAuthError("RenderHour did not return an authorization code", { code: "invalid_request", status: 400 });
  if (!isString(codeVerifier) || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    throw new RenderHourOAuthError("RenderHour sign-in lost its PKCE verifier", { code: "invalid_pkce", status: 400 });
  }
  const response = await oauthFetch(
    RENDERHOUR_OAUTH_ENDPOINTS.token,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    },
    options
  );
  if (!response.ok) {
    const code = readErrorCode(await response.text().catch(() => ""));
    throw new RenderHourOAuthError(`RenderHour token exchange failed (${code || `HTTP ${response.status}`})`, {
      code: code || "unknown",
      status: response.status === 400 || response.status === 401 ? 401 : 502,
    });
  }
  const tokens = parseTokenBody(await readJsonObject(response));
  if (!tokens) throw new RenderHourOAuthError("RenderHour returned a malformed token response", { code: "malformed_response", status: 502 });
  return tokens;
}

/** Who signed in. Failure is not fatal: an empty object keeps the sign-in. */
export async function fetchRenderHourUserInfo(accessToken, options = {}) {
  if (!validToken(accessToken)) return {};
  try {
    const response = await oauthFetch(
      RENDERHOUR_OAUTH_ENDPOINTS.userinfo,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      options
    );
    if (!response.ok) {
      void response.body?.cancel?.().catch?.(() => {});
      return {};
    }
    return (await readJsonObject(response)) || {};
  } catch {
    options.signal?.throwIfAborted?.();
    return {};
  }
}

function readString(value) {
  return isString(value) && value.trim() && value.length <= 320 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
}

/** The connection fields the generic OAuth completion stores (source mapTokens shape). */
export function mapRenderHourTokens(tokens, extra) {
  const userInfo = isObject(extra?.userInfo) ? extra.userInfo : {};
  const email = readString(userInfo.email);
  const accountId = readString(userInfo.sub);
  const providerSpecificData = { tokenType: tokens?.token_type || "Bearer", authMode: "oauth" };
  if (accountId) providerSpecificData.accountId = accountId;
  return {
    accessToken: tokens?.access_token,
    refreshToken: tokens?.refresh_token ?? undefined,
    expiresIn: tokens?.expires_in ?? undefined,
    email,
    name: readString(userInfo.name) || email,
    providerSpecificData,
  };
}

/**
 * Refresh once. Result shapes match the shared refresh model in
 * src/shared/services/providerCredentials.js (refreshAndUpdateCredentials):
 *   - { accessToken, refreshToken?, expiresIn? } on success;
 *   - { error: "unrecoverable_refresh_error", code } when the refresh token is
 *     spent or expired (invalid_grant, invalid_token, token_expired, or a 401):
 *     the shared path reconciles a concurrent winner, then marks reauth_required;
 *   - null for anything transient (network, 5xx, 429, malformed body, redirect):
 *     the stored credentials are kept.
 * Concurrent calls with the same refresh token share one POST (dedupRefresh),
 * so a single-use token is never presented twice by this process.
 */
export async function refreshRenderHourToken(refreshToken, log = null, { clientId = resolveRenderHourClientId(), ...options } = {}) {
  if (!validToken(refreshToken)) return null;
  if (!isString(clientId) || !CLIENT_ID_RE.test(clientId)) {
    log?.warn?.("TOKEN_REFRESH", `RenderHour refresh skipped: ${CLIENT_ID_CONFIG_ERROR}`);
    return null;
  }
  return dedupRefresh(
    RENDERHOUR_OAUTH_PROVIDER,
    refreshToken,
    async () => {
      let response;
      try {
        response = await oauthFetch(
          RENDERHOUR_OAUTH_ENDPOINTS.token,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
          },
          options
        );
      } catch (error) {
        options.signal?.throwIfAborted?.();
        log?.warn?.("TOKEN_REFRESH", `RenderHour refresh failed (${error?.code || "network"})`);
        return null;
      }
      if (!response.ok) {
        const code = readErrorCode(await response.text().catch(() => ""));
        if ((code && UNRECOVERABLE_REFRESH_CODES.has(code)) || response.status === 401) {
          log?.error?.("TOKEN_REFRESH", "RenderHour refresh token already used or expired. Sign in again.", {
            status: response.status,
            errorCode: code || "unauthorized",
          });
          return { error: "unrecoverable_refresh_error", code: code || "unauthorized" };
        }
        log?.warn?.("TOKEN_REFRESH", "RenderHour refresh failed", { status: response.status, errorCode: code || "unknown" });
        return null;
      }
      const tokens = parseTokenBody(await readJsonObject(response));
      if (!tokens) {
        log?.warn?.("TOKEN_REFRESH", "RenderHour refresh returned a malformed token response");
        return null;
      }
      log?.info?.("TOKEN_REFRESH", "Refreshed RenderHour token", {
        hasNewRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
      });
      const result = { accessToken: tokens.access_token };
      if (tokens.refresh_token) result.refreshToken = tokens.refresh_token;
      if (tokens.expires_in) result.expiresIn = tokens.expires_in;
      return result;
    },
    log,
    options.proxyOptions ?? null
  );
}

/**
 * True when the stored access token is missing, has no readable expiry, or
 * expires within the lead. Same decision the shared executors make.
 */
export function needsRenderHourRefresh(credentials, now = Date.now()) {
  if (!validToken(credentials?.refreshToken)) return false;
  if (!validToken(credentials?.accessToken)) return true;
  const expiresAt = credentials.expiresAt ?? credentials.tokenExpiresAt;
  const ms = isNumber(expiresAt) ? (expiresAt < 1e12 ? expiresAt * 1000 : expiresAt) : new Date(expiresAt ?? NaN).getTime();
  if (!Number.isFinite(ms)) return true;
  return ms - now <= RENDERHOUR_REFRESH_LEAD_MS;
}

/**
 * Executor hooks for the shared refresh model. Registration attaches these to a
 * RenderHour executor (needsRefresh / refreshCredentials) and to the
 * REFRESH_HANDLERS table in open-sse/services/tokenRefresh.js.
 */
export function createRenderHourRefreshHooks({ clientId, fetchImpl, now = Date.now } = {}) {
  return {
    needsRefresh: (credentials) => needsRenderHourRefresh(credentials, now()),
    refreshCredentials: (credentials, log, proxyOptions = null) => {
      const options = { clientId: clientId ?? resolveRenderHourClientId(), proxyOptions };
      if (fetchImpl) options.fetchImpl = fetchImpl;
      return refreshRenderHourToken(credentials?.refreshToken, log, options);
    },
  };
}

/** The API Authorization value for a stored OAuth connection. Throws a 401 error otherwise. */
export function renderHourOAuthAuthorization(credentials) {
  const token = validToken(credentials?.accessToken);
  if (!token || /^rh_/.test(token)) {
    throw new RenderHourOAuthError("RenderHour sign-in has no usable access token", { code: "reauth_required", status: 401 });
  }
  return `Bearer ${token}`;
}
