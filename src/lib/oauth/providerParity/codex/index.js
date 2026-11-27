// Staged Codex sign-in parity helper (#2034). Web-safe: no Node built-ins,
// no Node I/O. Exchange uses the existing fetch transport. The helpers remain staged; the
// central integration slots are listed in ./registration.json.
//
// Source attribution (MIT):
// - router-for-me/CLIProxyAPI @ dbe641f286a489ecb39e3c041c554371e6add864
//   internal/auth/codex/openai_auth.go (GenerateAuthURL, refreshTokensSingleFlight)
//   sdk/auth/codex.go, sdk/auth/codex_device.go (login modes)
// - cheaper-inference/OmniRoute @ b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523
//   src/lib/oauth/constants/oauth.ts (CODEX_CONFIG.extraParams.prompt)
//   open-sse/services/tokenRefresh/providers/codex.ts (refreshCodexToken)
import { isString } from "../../../../shared/utils/typeChecks.js";

/** Codex (non-SIWC) token endpoint used by both pinned sources. */
export const CODEX_SOURCE_TOKEN_URL = "https://auth.openai.com/oauth/token";

/** Login modes the `codex` provider supports. SIWC belongs to `chatgpt-plan`. */
export const CODEX_LOGIN_MODES = Object.freeze(["browser", "device"]);

/**
 * Parameters both sources add to the browser authorization URL that the
 * registry's `extraParams` lacks. `prompt=login` forces a fresh login so a
 * second account does not reuse the first browser session.
 */
export const CODEX_AUTHORIZE_DELTA = Object.freeze({ prompt: "login" });

function fail(message) {
  const error = new Error(message);
  error.code = "OAUTH_VALIDATION_FAILED";
  return error;
}

/** Add the source authorize delta to an already built Codex authorize URL. */
export function withCodexAuthorizeDelta(authUrl) {
  const url = new URL(authUrl);
  for (const [name, value] of Object.entries(CODEX_AUTHORIZE_DELTA)) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, value);
  }
  return url.href;
}

/**
 * Safe device poll failure. CLIProxyAPI `pollCodexDeviceToken` ends on any
 * status other than 2xx, 403 or 404 and has no error-code vocabulary, so the
 * web result keeps only the status; the provider body never reaches a client.
 */
export function codexDevicePollError(status) {
  const httpStatus = Number.isSafeInteger(status) ? status : 0;
  return { error: "device_token_failed", error_description: `Codex device authorization failed (HTTP ${httpStatus})` };
}

/** Reject an unsupported login mode before any network call. */
export function assertCodexLoginMode(mode = "browser") {
  if (!CODEX_LOGIN_MODES.includes(mode)) {
    throw fail(`Unsupported Codex login mode: ${isString(mode) ? mode.slice(0, 32) : "non-string"}`);
  }
  return mode;
}

/**
 * Build the source refresh request. Both sources send a form body. CLIProxyAPI
 * also sends `scope=openid profile email`; OmniRoute omits `scope`. The caller
 * chooses: omit `scope` for the OmniRoute contract, pass it for CLIProxyAPI's.
 */
export function buildCodexRefreshRequest({ refreshToken, clientId, scope } = {}) {
  if (!isString(refreshToken) || !refreshToken.trim()) throw fail("Codex refresh token is required");
  if (!isString(clientId) || !clientId.trim()) throw fail("Codex client ID is required");
  const form = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (scope !== undefined) {
    if (!isString(scope) || !scope.trim()) throw fail("Invalid Codex refresh scope");
    form.set("scope", scope);
  }
  return {
    url: CODEX_SOURCE_TOKEN_URL,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    },
  };
}

/**
 * Codex form exchange, staged for the existing provider exchangeToken slot.
 * MIT source: CLIProxyAPI dbe641f, internal/auth/codex/openai_auth.go.
 * The caller owns state, PKCE, workspace validation and connection persistence.
 */
export async function exchangeCodexCode(config, code, redirectUri, codeVerifier, _state, _meta, proxyOptions, signal) {
  if (!config?.clientId || !config?.tokenUrl || !code || !redirectUri || !codeVerifier) {
    throw new Error("Invalid Codex authorization exchange");
  }
  try {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code", client_id: config.clientId,
        code, redirect_uri: redirectUri, code_verifier: codeVerifier,
      }).toString(),
      proxyOptions,
      signal: signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error();
    const tokens = await response.json();
    if (!isString(tokens?.access_token) || !tokens.access_token.trim() || tokens.error) throw new Error();
    return tokens;
  } catch {
    // Never retry a one-use code or reveal transport errors / upstream bodies.
    throw new Error("Codex token exchange failed");
  }
}
