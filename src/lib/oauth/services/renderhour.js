// RenderHour subscription sign-in: the OAuth provider handler and a standalone
// sign-in session. STAGED: not in the PROVIDERS map of src/lib/oauth/providers.js
// and not exported from ./index.js, so no route can start it yet.
// See docs/providers/renderhour.md.
//
// Adapted from cheaper-inference/OmniRoute at
// 9671192011beb2d7f83979f40be488c5da8772b9 (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza): src/lib/oauth/providers/renderhour.ts.
// The protocol itself lives in open-sse/services/renderhour/oauth.js.
//
// Two ways in:
//   - `renderhourOAuthProvider` has the handler shape the generic PKCE flow in
//     src/lib/oauth/providers.js calls (prepareConfig, buildAuthUrl,
//     exchangeToken, postExchange, mapTokens). That flow already binds state,
//     verifier and redirect URI through src/lib/oauth/flowStore.js.
//   - `beginRenderHourSignIn` / `completeRenderHourSignIn` bind the same three
//     values themselves for a caller that has no flow store, and refuse a
//     second completion of the same session.

import { createHash, timingSafeEqual } from "node:crypto";
import { generatePKCE } from "../utils/pkce.js";
import { isObject, isString } from "../../../shared/utils/typeChecks.js";
import {
  RENDERHOUR_CODE_CHALLENGE_METHOD,
  RENDERHOUR_OAUTH_ENDPOINTS,
  RenderHourOAuthError,
  assertRenderHourRedirectUri,
  buildRenderHourAuthorizeUrl,
  exchangeRenderHourCode,
  fetchRenderHourUserInfo,
  mapRenderHourTokens,
  resolveRenderHourClientId,
} from "../../../../open-sse/services/renderhour/oauth.js";

export const RENDERHOUR_SIGN_IN_TTL_MS = 10 * 60 * 1000;

// Error codes an authorize callback may carry that are named back to the user.
const CALLBACK_ERRORS = new Map([
  ["access_denied", "RenderHour sign-in was cancelled"],
  ["invalid_request", "RenderHour refused the sign-in request"],
  ["unauthorized_client", "RenderHour does not allow this client to sign in"],
  ["server_error", "RenderHour could not complete the sign-in"],
  ["temporarily_unavailable", "RenderHour sign-in is temporarily unavailable"],
]);

function configWithClientId(config, env = process.env) {
  return { ...config, clientId: resolveRenderHourClientId(env) };
}

export const RENDERHOUR_OAUTH_CONFIG = Object.freeze({
  authorizeUrl: RENDERHOUR_OAUTH_ENDPOINTS.authorize,
  tokenUrl: RENDERHOUR_OAUTH_ENDPOINTS.token,
  userinfoUrl: RENDERHOUR_OAUTH_ENDPOINTS.userinfo,
  codeChallengeMethod: RENDERHOUR_CODE_CHALLENGE_METHOD,
  clientId: null,
});

/** Handler for the generic PKCE flow. Not registered. */
export const renderhourOAuthProvider = Object.freeze({
  config: RENDERHOUR_OAUTH_CONFIG,
  flowType: "authorization_code_pkce",
  // The client id is read per flow so an operator can set it without a rebuild.
  prepareConfig: async (config) => configWithClientId(config),
  buildAuthUrl: (config, redirectUri, state, codeChallenge) =>
    buildRenderHourAuthorizeUrl({ clientId: config?.clientId, redirectUri, state, codeChallenge }),
  exchangeToken: (config, code, redirectUri, codeVerifier, _state, _meta, proxyOptions = null) =>
    exchangeRenderHourCode({ clientId: config?.clientId, code, redirectUri, codeVerifier }, { proxyOptions }),
  // Who signed in, so a second sign-in to the same account updates its connection.
  postExchange: async (tokens, proxyOptions = null, _unused, signal) => ({
    userInfo: await fetchRenderHourUserInfo(tokens?.access_token, { proxyOptions, signal }),
  }),
  mapTokens: mapRenderHourTokens,
});

/**
 * The key that decides whether a new sign-in replaces an existing connection:
 * RenderHour's account id (userinfo `sub`), then email. Null when neither is known,
 * in which case the caller must create a new connection rather than guess.
 */
export function renderHourAccountKey(mapped) {
  const accountId = mapped?.providerSpecificData?.accountId;
  if (isString(accountId) && accountId) return `sub:${accountId}`;
  if (isString(mapped?.email) && mapped.email) return `email:${mapped.email.toLowerCase()}`;
  return null;
}

/**
 * Pick the stored RenderHour OAuth connection the mapped sign-in belongs to, if
 * any. Account ids decide when both sides have one; two different ids never
 * match, even with the same email. Email decides only when an id is missing.
 */
export function selectRenderHourConnection(connections, mapped) {
  if (!renderHourAccountKey(mapped) || !Array.isArray(connections)) return null;
  const idOf = (c) => {
    const id = c?.providerSpecificData?.accountId;
    return isString(id) && id ? id : null;
  };
  const emailOf = (c) => (isString(c?.email) && c.email ? c.email.toLowerCase() : null);
  const mappedId = idOf(mapped);
  const mappedEmail = emailOf(mapped);
  const candidates = connections.filter((c) => c?.provider === "renderhour" && c?.authType === "oauth");
  if (mappedId) {
    const byId = candidates.find((c) => idOf(c) === mappedId);
    if (byId) return byId;
  }
  return (
    candidates.find((c) => {
      const storedId = idOf(c);
      if (mappedId && storedId && storedId !== mappedId) return false;
      return mappedEmail !== null && emailOf(c) === mappedEmail;
    }) || null
  );
}

/** Start a sign-in. Keep `session` server-side; send the user to `authUrl`. */
export function beginRenderHourSignIn({ redirectUri, env = process.env, now = Date.now, ttlMs = RENDERHOUR_SIGN_IN_TTL_MS } = {}) {
  const clientId = resolveRenderHourClientId(env);
  assertRenderHourRedirectUri(redirectUri);
  const { codeVerifier, codeChallenge, state } = generatePKCE(32);
  const authUrl = buildRenderHourAuthorizeUrl({ clientId, redirectUri, state, codeChallenge });
  return {
    authUrl,
    session: { clientId, state, codeVerifier, redirectUri, expiresAt: now() + ttlMs, used: false },
  };
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest();
}

function sameRedirectTarget(callbackUrl, redirectUri) {
  let callback;
  let expected;
  try {
    callback = new URL(callbackUrl);
    expected = new URL(redirectUri);
  } catch {
    return false;
  }
  return callback.origin === expected.origin && callback.pathname === expected.pathname;
}

/**
 * Finish a sign-in from the redirect the browser landed on. Checks, in order:
 * the session is unused and unexpired, the callback hit the bound redirect URI,
 * no authorize error, the state matches (constant time), a code is present.
 * The session is marked used before the code is exchanged, so a replayed or
 * concurrent callback never spends the code twice. Returns the connection
 * fields to store (mapRenderHourTokens shape).
 */
export async function completeRenderHourSignIn(session, callbackUrl, { now = Date.now, ...options } = {}) {
  if (!isObject(session)) {
    throw new RenderHourOAuthError("RenderHour sign-in session is missing", { code: "invalid_state", status: 400 });
  }
  if (session.used) throw new RenderHourOAuthError("RenderHour sign-in was already completed", { code: "session_used", status: 400 });
  if (!(now() < session.expiresAt)) {
    session.used = true;
    throw new RenderHourOAuthError("RenderHour sign-in expired. Start again.", { code: "session_expired", status: 400 });
  }
  if (!sameRedirectTarget(callbackUrl, session.redirectUri)) {
    throw new RenderHourOAuthError("RenderHour sign-in returned to an unexpected address", { code: "redirect_mismatch", status: 400 });
  }
  const params = new URL(callbackUrl).searchParams;
  const error = params.get("error");
  if (error) {
    session.used = true;
    throw new RenderHourOAuthError(CALLBACK_ERRORS.get(error) || "RenderHour sign-in failed", {
      code: CALLBACK_ERRORS.has(error) ? error : "unknown",
      status: error === "access_denied" ? 403 : 400,
    });
  }
  const state = params.get("state");
  if (!state || !timingSafeEqual(digest(state), digest(session.state))) {
    // A forged callback does not burn the real session.
    throw new RenderHourOAuthError("RenderHour sign-in state does not match. Start again.", { code: "invalid_state", status: 400 });
  }
  const code = params.get("code");
  if (!code) {
    session.used = true;
    throw new RenderHourOAuthError("RenderHour did not return an authorization code", { code: "invalid_request", status: 400 });
  }
  session.used = true;
  const tokens = await exchangeRenderHourCode(
    { clientId: session.clientId, code, redirectUri: session.redirectUri, codeVerifier: session.codeVerifier },
    options
  );
  const userInfo = await fetchRenderHourUserInfo(tokens.access_token, options);
  return mapRenderHourTokens(tokens, { userInfo });
}
