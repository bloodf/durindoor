// Staged GapGPT OAuth provider object and refresh helper (#2034).
//
// Source: decolua/9router PR #3350, head 1f45c0e7b29bede1693ca0df613da957d67826bf
// (MIT): `src/lib/oauth/providers/gapgpt.js` (buildAuthUrl, exchangeToken,
// mapTokens) and `open-sse/services/tokenRefresh/providers.js`
// (`refreshGapgptToken`). Rewritten for DurinDoor's provider-object contract
// (`src/lib/oauth/providers.js` PROVIDERS entries); nothing is copied verbatim.
//
// Differences from the source, all deliberate:
// - the redirect URI and client id are bound by the provider, not taken from
//   the caller: `buildAuthUrl` reports the fixed loopback redirect and the
//   client id back to `generateAuthData`, which stores both in the flow
//   payload, and `exchangeToken` refuses a payload that does not match;
// - a failed or non-JSON exchange reports its HTTP status and, at most, a
//   short OAuth error code. The source threw the raw response body;
// - `proxyOptions` from the claimed flow reaches the token request, so the
//   exchange uses the proxy the user selected for this sign-in;
// - a refresh response without a credential is refused instead of mapping
//   `accessToken: undefined` over the stored key.

import { isRecord, isString } from "../../../../shared/utils/typeChecks.js";
import {
  GAPGPT_LOOPBACK_REDIRECT_URI,
  GAPGPT_OAUTH_CONFIG,
  GAPGPT_TOKEN_ORIGIN
} from "./config.js";

const SAFE_ERROR_CODE = /^[a-z][a-z0-9_.-]{0,63}$/i;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const PERMANENT_REFRESH_CODES = new Set([
  "invalid_grant",
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
  "token_expired"
]);

/** Error whose message never carries a response body or a credential. */
export class GapgptOAuthError extends Error {
  constructor(code, message, { status = null, upstreamCode = null } = {}) {
    super(message);
    this.name = "GapgptOAuthError";
    this.code = code;
    if (status !== null) this.status = status;
    if (upstreamCode) this.upstreamCode = upstreamCode;
  }
}

function nonEmptyString(value) {
  return isString(value) && value.trim() ? value.trim() : null;
}

function requireTokenUrl(config) {
  const raw = config?.tokenUrl || GAPGPT_OAUTH_CONFIG.tokenUrl;
  let url;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (!url || url.origin !== GAPGPT_TOKEN_ORIGIN) {
    throw new GapgptOAuthError(
      "OAUTH_VALIDATION_FAILED",
      "GapGPT token endpoint is not the pinned gapgpt.app origin"
    );
  }
  return url.toString();
}

/** Read a JSON body without ever returning or throwing its raw text. */
async function readJsonBody(response) {
  try {
    const raw = await response.text();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A short OAuth error code from a parsed body, or null. Never the description. */
export function readSafeGapgptErrorCode(body) {
  const candidate = body?.error?.code ?? body?.error ?? body?.data?.error ?? body?.error_code;
  return isString(candidate) && SAFE_ERROR_CODE.test(candidate) ? candidate : null;
}

/** GapGPT wraps some /api/v1/* success bodies as `{ data: {...} }`. */
export function unwrapGapgptEnvelope(body) {
  if (!isRecord(body)) return null;
  return isRecord(body.data) ? body.data : body;
}

/**
 * Pick the gateway credential. The CLI endpoint issues a long-lived API key
 * (`api_key`); `apiKey` and `access_token` are accepted in that order, as the
 * source does, in case the response shape changes.
 */
export function readGapgptCredential(tokens) {
  const t = unwrapGapgptEnvelope(tokens);
  if (!t) return { credential: null, field: null };
  for (const field of ["api_key", "apiKey", "access_token"]) {
    const value = nonEmptyString(t[field]);
    if (value) return { credential: value, field };
  }
  return { credential: null, field: null };
}

function readExpiresIn(t) {
  const value = Number(t?.expires_in);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function assertBoundExchange(config, redirectUri, codeVerifier, meta) {
  if (redirectUri !== GAPGPT_LOOPBACK_REDIRECT_URI) {
    throw new GapgptOAuthError(
      "OAUTH_REDIRECT_MISMATCH",
      "GapGPT sign-in must use its fixed loopback redirect"
    );
  }
  const clientId = config?.clientId || GAPGPT_OAUTH_CONFIG.clientId;
  if (meta?.clientId !== clientId) {
    throw new GapgptOAuthError(
      "OAUTH_CLIENT_MISMATCH",
      "GapGPT sign-in flow was issued for a different client"
    );
  }
  if (!nonEmptyString(codeVerifier)) {
    throw new GapgptOAuthError("OAUTH_VALIDATION_FAILED", "GapGPT sign-in is missing its PKCE verifier");
  }
  return clientId;
}

export const gapgptProvider = Object.freeze({
  config: GAPGPT_OAUTH_CONFIG,
  flowType: "authorization_code_pkce",
  fixedPort: GAPGPT_OAUTH_CONFIG.fixedPort,
  callbackPath: GAPGPT_OAUTH_CONFIG.callbackPath,

  /**
   * Returns a record, not a bare URL: `generateAuthData` stores the reported
   * `redirectUri` in the flow payload and merges `clientId` into its `meta`,
   * so the exchange can prove the callback belongs to this client.
   */
  buildAuthUrl(config, _redirectUri, state, codeChallenge) {
    const effective = config || GAPGPT_OAUTH_CONFIG;
    if (!nonEmptyString(state)) {
      throw new GapgptOAuthError("OAUTH_VALIDATION_FAILED", "GapGPT sign-in needs a state value");
    }
    if (!isString(codeChallenge) || !PKCE_CHALLENGE.test(codeChallenge)) {
      throw new GapgptOAuthError("OAUTH_VALIDATION_FAILED", "GapGPT sign-in needs an S256 PKCE challenge");
    }
    if (effective.codeChallengeMethod !== "S256") {
      throw new GapgptOAuthError("OAUTH_VALIDATION_FAILED", "GapGPT sign-in only supports S256 PKCE");
    }
    const url = new URL(effective.authorizeUrl);
    const params = {
      response_type: "code",
      client_id: effective.clientId,
      redirect_uri: GAPGPT_LOOPBACK_REDIRECT_URI,
      scope: effective.scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ...effective.extraParams,
      state
    };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return {
      authUrl: url.toString(),
      redirectUri: GAPGPT_LOOPBACK_REDIRECT_URI,
      clientId: effective.clientId
    };
  },

  async exchangeToken(config, code, redirectUri, codeVerifier, _state, meta, proxyOptions) {
    const clientId = assertBoundExchange(config, redirectUri, codeVerifier, meta);
    if (!nonEmptyString(code)) {
      throw new GapgptOAuthError("OAUTH_VALIDATION_FAILED", "No authorization code received");
    }
    const response = await fetch(requireTokenUrl(config), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: GAPGPT_LOOPBACK_REDIRECT_URI,
        code_verifier: codeVerifier
      }),
      ...(proxyOptions ? { proxyOptions } : null)
    });
    const body = await readJsonBody(response);
    if (!response.ok) {
      const upstreamCode = readSafeGapgptErrorCode(body);
      throw new GapgptOAuthError(
        "OAUTH_UPSTREAM_FAILURE",
        `GapGPT token exchange failed (${response.status}${upstreamCode ? `: ${upstreamCode}` : ""})`,
        { status: response.status, upstreamCode }
      );
    }
    if (!body) {
      throw new GapgptOAuthError(
        "OAUTH_UPSTREAM_FAILURE",
        `GapGPT token exchange returned an unreadable response (${response.status})`,
        { status: response.status }
      );
    }
    return body;
  },

  mapTokens(tokens) {
    const t = unwrapGapgptEnvelope(tokens);
    const { credential, field } = readGapgptCredential(t);
    if (!credential) {
      throw new GapgptOAuthError("OAUTH_UPSTREAM_FAILURE", "GapGPT returned no credential");
    }
    const mapped = {
      // The executor sends accessToken as `Authorization: Bearer`; apiKey keeps
      // API-key-style consumers and the tokenless-exchange guard working.
      accessToken: credential,
      apiKey: credential,
      lastRefreshAt: new Date().toISOString(),
      providerSpecificData: {
        authMethod: "pkce",
        // Which field carried the credential, never its value.
        credentialField: field
      }
    };
    const refreshToken = nonEmptyString(t.refresh_token);
    if (refreshToken) mapped.refreshToken = refreshToken;
    const expiresIn = readExpiresIn(t);
    if (expiresIn) mapped.expiresIn = expiresIn;
    return mapped;
  }
});

/** Build the refresh request without sending it. */
export function buildGapgptRefreshRequest(refreshToken, { config = GAPGPT_OAUTH_CONFIG, proxyOptions = null } = {}) {
  return {
    url: requireTokenUrl(config),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        client_id: config?.clientId || GAPGPT_OAUTH_CONFIG.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }),
      ...(proxyOptions ? { proxyOptions } : null)
    }
  };
}

/**
 * Refresh a GapGPT credential, only when sign-in issued a refresh token.
 *
 * Returns `null` when there is nothing to refresh or the failure is transient
 * (the stored key stays), `{ error: "unrecoverable_refresh_error", code }`
 * when the refresh token itself was rejected, or the new credential. Neither
 * the response body nor any token appears in a return value's error fields or
 * in the log.
 */
export async function refreshGapgptCredential(refreshToken, { config, proxyOptions = null, fetchImpl = fetch, log = null } = {}) {
  const token = nonEmptyString(refreshToken);
  if (!token) return null;
  const { url, init } = buildGapgptRefreshRequest(token, { config, proxyOptions });
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    log?.error?.("TOKEN_REFRESH", "GapGPT refresh request failed before a response");
    return null;
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const code = readSafeGapgptErrorCode(body);
    const permanent = response.status === 401 || Boolean(code && PERMANENT_REFRESH_CODES.has(code));
    log?.error?.("TOKEN_REFRESH", "GapGPT refresh rejected", { status: response.status, code });
    return permanent ? { error: "unrecoverable_refresh_error", code: code || `http_${response.status}` } : null;
  }
  const t = unwrapGapgptEnvelope(body);
  const { credential } = readGapgptCredential(t);
  if (!credential) {
    log?.error?.("TOKEN_REFRESH", "GapGPT refresh returned no credential", { status: response.status });
    return null;
  }
  const result = {
    accessToken: credential,
    apiKey: credential,
    refreshToken: nonEmptyString(t.refresh_token) || token
  };
  const expiresIn = readExpiresIn(t);
  if (expiresIn) result.expiresIn = expiresIn;
  return result;
}
