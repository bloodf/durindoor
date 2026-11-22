// Devin Desktop sign-in (staged; not registered in src/lib/oauth/providers.js yet).
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// src/lib/oauth/providers/devin-desktop.ts and DEVIN_DESKTOP_CONFIG in
// src/lib/oauth/constants/oauth.ts (MIT).
//
// Two ways in, both producing the same credential, a Devin session token:
//  1. Import: paste a session token (or API key) from an authenticated Devin session.
//  2. Browser sign-in: the Devin CLI login. PKCE (S256, 96-byte verifier) on
//     app.devin.ai, loopback callback on the fixed port 59653, then a JSON
//     {code, code_verifier} exchange on api.devin.ai that returns one session token.
//
// There is no refresh token and no expiry: the upstream never issues either and
// excludes Devin from token refresh. A rejected session token means "sign in again".
// What *is* refreshed is the short-lived user JWT, which the executor mints from the
// session token on every request (GetUserJwt).
import { isString } from "../../../shared/utils/typeChecks.js";

export const DEVIN_DESKTOP_CONFIG = Object.freeze({
  apiServerUrl: "https://server.codeium.com",
  inferenceUrl: "https://inference.codeium.com",
  ideName: "windsurf",
  defaultVersion: "3.6.27",
  authorizeUrl: "https://app.devin.ai/auth/cli/continue",
  tokenUrl: "https://api.devin.ai/auth/cli/token",
  codeChallengeMethod: "S256",
  callbackPort: 59653,
  callbackPath: "/callback",
  callbackHost: "127.0.0.1",
});

/** Prefix the Devin CLI puts in front of the session token it mints at sign-in. */
export const DEVIN_SESSION_TOKEN_PREFIX = "devin-session-token$";

/** Return the session token with exactly one `devin-session-token$` prefix. */
export function normalizeDevinSessionToken(token) {
  const value = String(token ?? "").trim();
  return value.startsWith(DEVIN_SESSION_TOKEN_PREFIX) ? value : `${DEVIN_SESSION_TOKEN_PREFIX}${value}`;
}

/**
 * The manual fallback lets the operator paste the whole callback URL. Pull the code out of
 * it and reject a state that does not belong to this login; a bare code passes through.
 */
export function resolveAuthorizationCode(raw, expectedState) {
  const value = String(raw ?? "").trim();
  if (!/^https?:\/\//i.test(value)) return value;
  const url = new URL(value);
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Devin callback is missing the authorization code");
  const state = url.searchParams.get("state");
  if (expectedState && state !== expectedState) throw new Error("Devin callback state mismatch");
  return code;
}

export function validateImportToken(token) {
  const trimmed = String(token ?? "").trim();
  if (!trimmed) return { valid: false, reason: "Token is empty" };
  if (trimmed.length < 16) return { valid: false, reason: "Token is too short" };
  return { valid: true };
}

export function mapTokens(tokens) {
  const mapped = { accessToken: tokens.accessToken, refreshToken: null, expiresIn: null };
  // Only the browser sign-in tags the connection; an imported key stays verbatim and untagged.
  if (tokens.authMethod) mapped.providerSpecificData = { authMethod: tokens.authMethod };
  return mapped;
}

/** Same record shape as the entries of src/lib/oauth/providers.js. */
export const devinDesktopOAuth = {
  config: DEVIN_DESKTOP_CONFIG,
  flowType: "import_token",
  supportsBrowserPkce: true,
  fixedPort: DEVIN_DESKTOP_CONFIG.callbackPort,
  callbackPath: DEVIN_DESKTOP_CONFIG.callbackPath,
  callbackHost: DEVIN_DESKTOP_CONFIG.callbackHost,
  // The Devin CLI uses a 96-byte verifier (128 base64url chars).
  pkceVerifierBytes: 96,

  validateImportToken,

  buildAuthUrl(config, redirectUri, state, codeChallenge) {
    const params = new URLSearchParams({
      redirect_uri: redirectUri,
      state,
      prompt: "select_account",
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },

  async exchangeToken(config, code, _redirectUri, codeVerifier, state, _meta, proxyOptions = null, fetcher = fetch) {
    const authorizationCode = resolveAuthorizationCode(code, state);
    const init = {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ code: authorizationCode, code_verifier: codeVerifier }),
    };
    if (proxyOptions) init.proxyOptions = proxyOptions;
    const response = await fetcher(config.tokenUrl, init);
    // Status only: the body can echo the code, and the route surfaces this message.
    if (!response.ok) throw new Error(`Devin token exchange failed: ${response.status}`);
    const data = await response.json().catch(() => null);
    if (!isString(data?.token) || !data.token.trim()) throw new Error("Devin token exchange returned no token");
    return { accessToken: normalizeDevinSessionToken(data.token), authMethod: "browser" };
  },

  mapTokens,
};

/**
 * Session tokens are not refreshable. Returns null, the "no refresh available" answer the
 * executor's refreshCredentials hook gives, so a rejected token is reported as expired
 * instead of triggering a refresh call that does not exist upstream.
 */
export async function refreshDevinDesktopSession() {
  return null;
}

export default devinDesktopOAuth;
