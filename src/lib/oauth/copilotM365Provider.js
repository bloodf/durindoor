/**
 * Microsoft 365 Copilot native sign-in: authorization-code flow with PKCE against the Microsoft
 * identity platform, for work or school accounts.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `src/lib/oauth/providers/copilot-m365-web.ts`
 * and `m365AuthAttempts.ts` at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
 *
 * Microsoft sends the code to its fixed native-client URL, which serves nothing. The user opens the
 * authorization URL in a browser with the Network log preserved, copies the full request URL of
 * that callback, and pastes it. The state, verifier and connection binding live in the shared
 * server-side OAuth flow record (flowStore), which makes an attempt single-use and expiring; this
 * adapter only checks the pasted URL against the state the flow issued.
 */
import {
  M365_NATIVE_REDIRECT_URI,
  M365_OAUTH_CONFIG,
  isM365Guid,
  getM365ClientId } from
"open-sse/config/copilotM365.js";
import { credentialFetch } from "open-sse/utils/credentialFetch.js";
import { m365IdentityFromAccessToken } from "open-sse/utils/m365Identity.js";
import { readBoundedResponseText, sanitizeErrorMessage } from "open-sse/utils/error.js";
import { timingSafeCompare } from "../../shared/utils/timingSafeCompare.js";
import { isNumber, isRecord, isString } from "../../shared/utils/typeChecks.js";

const MAX_CODE_LENGTH = 8192;
const MAX_TOKEN_LENGTH = 65536;
const MAX_TOKEN_RESPONSE_BYTES = 131072;
const EXCHANGE_TIMEOUT_MS = 15_000;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

function fail(message) {
  // Only fixed, local messages cross this boundary: never provider bodies or parser errors.
  throw new Error(sanitizeErrorMessage(message));
}

function requireRedirect(redirectUri) {
  if (redirectUri !== M365_NATIVE_REDIRECT_URI) fail("M365 requires the fixed native redirect URI");
}

/**
 * The authorization code in a pasted callback URL. The literal prefix is checked as well as the
 * parsed URL: normalization must not accept dot segments, backslashes, fragments, credentials,
 * ports or any other alias of the native callback, and an `error` answer is never a code.
 */
export function parseM365CallbackUrl(redirectedUrl, expectedState) {
  const raw = isString(redirectedUrl) ? redirectedUrl.trim() : "";
  let callback;
  try {
    callback = new URL(raw);
  } catch {
    fail("M365 requires the full redirected Microsoft URL");
  }
  const params = callback.searchParams;
  if (
  !raw.startsWith(`${M365_NATIVE_REDIRECT_URI}?`) ||
  raw.includes("#") ||
  callback.origin !== "https://login.microsoftonline.com" ||
  callback.pathname !== "/common/oauth2/nativeclient" ||
  callback.username ||
  callback.password ||
  callback.hash ||
  params.has("error") ||
  params.has("error_description") ||
  params.has("error_uri") ||
  params.getAll("code").length !== 1 ||
  params.getAll("state").length !== 1)
  {
    fail("M365 redirected URL is invalid");
  }
  const code = params.get("code");
  const state = params.get("state");
  if (
  !isString(expectedState) || !state || !timingSafeCompare(state, expectedState) ||
  !code || code.length > MAX_CODE_LENGTH || /\s|\p{Cc}/u.test(code))
  {
    fail("M365 redirected URL is invalid");
  }
  return code;
}

function parseTokens(body) {
  const tokenOk = (value) => isString(value) && value.length > 0 && value.length <= MAX_TOKEN_LENGTH;
  if (
  !isRecord(body) ||
  !tokenOk(body.access_token) ||
  !isString(body.token_type) || !/^Bearer$/i.test(body.token_type) ||
  !isNumber(body.expires_in) || !Number.isInteger(body.expires_in) || body.expires_in <= 0 || body.expires_in > 31_536_000 ||
  body.refresh_token !== undefined && !tokenOk(body.refresh_token) ||
  body.id_token !== undefined && !tokenOk(body.id_token))
  {
    fail("M365 token response is invalid");
  }
  return body;
}

const copilotM365 = {
  config: M365_OAUTH_CONFIG,
  flowType: "authorization_code_pkce",

  buildAuthUrl(config, redirectUri, state, codeChallenge) {
    // The route's default redirect is its own callback; Microsoft only accepts the native one.
    const params = new URLSearchParams({
      response_type: "code",
      client_id: getM365ClientId(),
      redirect_uri: M365_NATIVE_REDIRECT_URI,
      scope: config.scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state
    });
    return { authUrl: `${config.authorizeUrl}?${params}`, redirectUri: M365_NATIVE_REDIRECT_URI };
  },

  /** `code` is the full callback URL the user pasted. */
  async exchangeToken(config, code, redirectUri, codeVerifier, state, _meta, proxyOptions) {
    requireRedirect(redirectUri);
    if (!isString(codeVerifier) || !VERIFIER_RE.test(codeVerifier)) fail("M365 authorization exchange parameters are invalid");
    const authorizationCode = parseM365CallbackUrl(code, state);
    try {
      const response = await credentialFetch(
        (url, init) => fetch(url, { ...init, proxyOptions }),
        config.tokenUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: getM365ClientId(),
            code: authorizationCode,
            redirect_uri: M365_NATIVE_REDIRECT_URI,
            code_verifier: codeVerifier,
            scope: config.scope
          })
        }
      );
      if (!response.ok) {
        await response.body?.cancel?.();
        fail("M365 token exchange was rejected");
      }
      const text = await readBoundedResponseText(response, { maxBytes: MAX_TOKEN_RESPONSE_BYTES, timeoutMs: EXCHANGE_TIMEOUT_MS, throwOnTimeout: true });
      const tokens = parseTokens(JSON.parse(text));
      if (!m365IdentityFromAccessToken(tokens.access_token)) fail("M365 work or school identity is required");
      return tokens;
    } catch {
      fail("M365 token exchange failed; restart sign-in");
    }
  },

  mapTokens(tokens) {
    const identity = m365IdentityFromAccessToken(tokens.access_token);
    if (!identity || !isM365Guid(identity.oid) || !isM365Guid(identity.tid)) {
      fail("M365 work or school identity is required");
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      idToken: tokens.id_token || null,
      expiresIn: tokens.expires_in,
      email: identity.email,
      displayName: identity.name,
      providerSpecificData: {
        authMethod: "oauth",
        oid: identity.oid,
        tid: identity.tid,
        chathubPath: identity.chathubPath
      }
    };
  }
};

export default copilotM365;
