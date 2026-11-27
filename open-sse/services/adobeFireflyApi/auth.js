// Adobe Firefly Services API credentials: read a connection's credential and
// turn it into a bearer token for the fixed Firefly API origin.
//
// Two operator-owned shapes are accepted (docs/providers/adobe-firefly-api.md):
// - OAuth Server-to-Server: client ID in providerSpecificData.clientId and the
//   client secret in apiKey. Tokens are minted at the fixed IMS endpoint with
//   the client_credentials grant, cached in memory per credential and minted
//   again before expiry. A minted token is never written to the connection.
// - Pasted access token: client ID in providerSpecificData.clientId and an S2S
//   access token in accessToken. It cannot be refreshed.
//
// Adobe web-app client IDs, cookies and browser sessions are refused.
//
// Contract: AdobeDocs/ffs-firefly-api at 1027f559cdb1509a61b34e2f2da9618ec431f2cb,
// src/pages/getting-started/index.md ("Retrieve an access token").
import { createHash } from "node:crypto";
import {
  ADOBE_FIREFLY_SCOPE,
  ADOBE_IMS_TOKEN_URL,
  ADOBE_WEB_APP_CLIENT_IDS,
} from "../../providers/private/adobe-firefly-api.js";
import { resolveCredentialProxyOptions } from "../oauthCredentialManager.js";
import { readBoundedResponseText } from "../../utils/error.js";
import { isNumber, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

export const ADOBE_IMS_REQUEST_TIMEOUT_MS = 15_000;
// Mint again this long before IMS says the token expires.
export const ADOBE_TOKEN_REFRESH_SKEW_MS = 5 * 60_000;
export const ADOBE_TOKEN_CACHE_MAX_ENTRIES = 256;

const CLIENT_ID_RE = /^[A-Za-z0-9._-]{8,256}$/;
const SECRET_RE = /^[\x21-\x7e]{8,512}$/;
const TOKEN_RE = /^[\x21-\x7e]{16,8192}$/;
const MAX_IMS_BYTES = 32 * 1024;
// IMS error codes that may be repeated to the caller. Nothing else from IMS is.
const IMS_ERROR_CODES = new Set(["invalid_client", "unauthorized_client", "invalid_scope", "invalid_request", "invalid_grant"]);
const WEB_APP_IDS = new Set(ADOBE_WEB_APP_CLIENT_IDS.map((id) => id.toLowerCase()));

const fail = (message, status) => Object.assign(new Error(message), { status });

function jwtClientId(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return isRecord(payload) && isString(payload.client_id) ? payload.client_id : null;
  } catch {
    return null;
  }
}

function expiryMs(value) {
  if (isNumber(value) && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (isString(value) && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Read one connection's Firefly Services credential. Throws a 401 before any
 * request when it is missing, malformed, expired or a web-app identity.
 *
 * @returns {{ mode: "client_credentials", clientId: string, clientSecret: string }
 *   | { mode: "access_token", clientId: string, accessToken: string }}
 */
export function readAdobeFireflyCredential(credentials, now = Date.now) {
  const clientId = credentials?.providerSpecificData?.clientId;
  if (!isString(clientId) || !CLIENT_ID_RE.test(clientId)) {
    throw fail("Adobe Firefly Services needs the client ID of an OAuth Server-to-Server credential", 401);
  }
  if (WEB_APP_IDS.has(clientId.toLowerCase())) {
    throw fail("Adobe web-app client IDs are not accepted; use your own Developer Console credential", 401);
  }
  const secret = credentials?.apiKey;
  if (secret != null && secret !== "") {
    if (!isString(secret) || !SECRET_RE.test(secret)) throw fail("Adobe Firefly Services client secret is malformed", 401);
    return { mode: "client_credentials", clientId, clientSecret: secret };
  }
  const token = credentials?.accessToken;
  if (!isString(token) || !TOKEN_RE.test(token)) {
    throw fail("Adobe Firefly Services needs a client secret or an access token", 401);
  }
  const tokenClient = jwtClientId(token);
  if (tokenClient && (WEB_APP_IDS.has(tokenClient.toLowerCase()) || tokenClient !== clientId)) {
    throw fail("Adobe Firefly Services access token was not issued to this client ID", 401);
  }
  const expiresAt = expiryMs(credentials?.expiresAt);
  if (expiresAt !== null && expiresAt <= now()) {
    throw fail("Adobe Firefly Services access token has expired; paste a new one", 401);
  }
  return { mode: "access_token", clientId, accessToken: token };
}

// Rejects with the caller's abort reason without cancelling the shared work.
function raceAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); }
    );
  });
}

async function imsErrorCode(response, timeoutMs) {
  try {
    const parsed = JSON.parse(await readBoundedResponseText(response, { maxBytes: MAX_IMS_BYTES, timeoutMs }));
    return isRecord(parsed) && IMS_ERROR_CODES.has(parsed.error) ? parsed.error : null;
  } catch {
    return null;
  }
}

async function requestToken({ clientId, clientSecret }, { proxyOptions, now, requestTimeoutMs }) {
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  let response;
  try {
    response = await fetch(ADOBE_IMS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: ADOBE_FIREFLY_SCOPE,
      }).toString(),
      redirect: "error",
      signal: timeout,
      proxyOptions,
    });
  } catch {
    // A transport error's text can describe the request, so it is not repeated.
    if (timeout.aborted) throw fail("Adobe IMS token request timed out", 504);
    throw fail("Adobe IMS token request failed", 502);
  }
  if (!response.ok) {
    const { status } = response;
    const code = await imsErrorCode(response, requestTimeoutMs);
    const suffix = code ? ` (${code})` : "";
    if (status === 400 || status === 401) throw fail(`Adobe IMS refused the client credentials${suffix}`, 401);
    if (status === 403) throw fail(`Adobe IMS refused the client credentials${suffix}`, 403);
    if (status === 429) throw fail("Adobe IMS rate limited the token request", 429);
    throw fail(`Adobe IMS token request returned ${status}`, 502);
  }
  let parsed;
  try {
    parsed = JSON.parse(await readBoundedResponseText(response, { maxBytes: MAX_IMS_BYTES, timeoutMs: requestTimeoutMs, throwOnTimeout: true }));
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  const token = parsed?.access_token;
  const expiresIn = parsed?.expires_in;
  const tokenType = parsed?.token_type;
  if (
    !isString(token) || !TOKEN_RE.test(token) ||
    !isNumber(expiresIn) || !Number.isFinite(expiresIn) || expiresIn <= 0 ||
    (tokenType != null && (!isString(tokenType) || tokenType.toLowerCase() !== "bearer"))
  ) {
    throw fail("Adobe IMS returned an unusable token response", 502);
  }
  // Never trust a lifetime longer than the documented 24 hours.
  return { token, expiresAt: now() + Math.min(expiresIn, 86_400) * 1000 };
}

/**
 * An in-memory IMS token cache. Entries are keyed by a hash of client ID and
 * secret, so two connections never share a token, and a rotated secret mints
 * a new one. Concurrent requests for one credential share a single mint.
 */
export function createAdobeTokenCache({
  now = Date.now,
  maxEntries = ADOBE_TOKEN_CACHE_MAX_ENTRIES,
  refreshSkewMs = ADOBE_TOKEN_REFRESH_SKEW_MS,
  requestTimeoutMs = ADOBE_IMS_REQUEST_TIMEOUT_MS,
} = {}) {
  const entries = new Map();
  const inflight = new Map();
  const keyOf = ({ clientId, clientSecret }) =>
    createHash("sha256").update(clientId).update("\n").update(clientSecret).digest("hex");

  return {
    /** @returns {Promise<string>} a bearer token for this credential */
    async get(credential, { credentials, signal } = {}) {
      signal?.throwIfAborted();
      const key = keyOf(credential);
      const entry = entries.get(key);
      if (entry && entry.expiresAt - refreshSkewMs > now()) return entry.token;
      if (entry) entries.delete(key);
      let pending = inflight.get(key);
      if (!pending) {
        // Not tied to one caller's signal: other callers may be waiting on it.
        pending = requestToken(credential, {
          proxyOptions: resolveCredentialProxyOptions(credentials),
          now,
          requestTimeoutMs,
        }).then((minted) => {
          entries.delete(key);
          while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
          entries.set(key, minted);
          return minted.token;
        }).finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      return raceAbort(pending, signal);
    },
    // Drop a token Adobe rejected. Given the rejected token, a newer one for
    // the same credential is kept; without it, the cached token is dropped.
    invalidate(credential, token) {
      const key = keyOf(credential);
      if (token === undefined || entries.get(key)?.token === token) entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

export const defaultAdobeTokenCache = createAdobeTokenCache();

/**
 * Bearer token and client ID for one request.
 * @returns {Promise<{ credential: object, clientId: string, token: string }>}
 */
export async function resolveAdobeFireflyAuth(credentials, { cache = defaultAdobeTokenCache, signal, now = Date.now } = {}) {
  const credential = readAdobeFireflyCredential(credentials, now);
  const token = credential.mode === "client_credentials"
    ? await cache.get(credential, { credentials, signal })
    : credential.accessToken;
  return { credential, clientId: credential.clientId, token };
}

/**
 * Handle a submit 401 for one request's auth. In client-credentials mode the
 * rejected token is dropped from the cache (a newer one is kept); with `retry`,
 * one new token is minted, bounded by the IMS request timeout and the caller's
 * signal, and true is returned when it differs from the rejected one, so the
 * image core may resend the refused submit once. The new token lives only in
 * the in-memory cache: nothing is returned to merge into or persist on the
 * connection. A pasted token has nothing to drop or refresh, so it is false.
 * A failed mint is false; a caller abort rejects.
 *
 * @param {{ credential: object, token: string }} auth - from resolveAdobeFireflyAuth
 * @returns {Promise<boolean>}
 */
export async function refreshAdobeFireflyToken(auth, { cache = defaultAdobeTokenCache, credentials, signal, retry = true } = {}) {
  if (auth?.credential?.mode !== "client_credentials") return false;
  cache.invalidate(auth.credential, auth.token);
  if (!retry) return false;
  let fresh;
  try {
    fresh = await cache.get(auth.credential, { credentials, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
  return fresh !== auth.token;
}
