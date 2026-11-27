// Per-account Clerk session controller for staged UC consumer connections.
// Port of OmniRoute c71f0065 open-sse/executors/uc/clerkAuth.ts:
//
//   mint (clerkAuth.ts:89-154):
//     POST /v1/client/sessions/{sid}/tokens?_clerk_js_version=5.127.1   (empty body)
//     -> 200 { object: "token", jwt }   (the source also reads a top-level `token`)
//     Set-Cookie may rotate cookies; they are handed back for the same account.
//   A 401/403 means the durable login is invalid: re-login (clerkAuth.ts:85-87).
//   Cache: per session, re-mint 8 s before `exp` (constants.ts:35-36,
//   clerkAuth.ts:156-180).
//
// The source has no session touch call, so none is made here.
//
// Session JWT claims the source documents: a 60 s RS256 JWT with
// `iss: clerk.uncensored.com`, `exp - iat = 60` (clerkAuth.ts:4-6) and a `uid`
// claim equal to the account uid (credentials.ts:12-15, uidFromSessionJwt at
// credentials.ts:62-66). The source never requires `uid` to be present.
//
// Fork deviations: the token cache lives inside one controller instance, is
// keyed by uid, sid and a digest of the durable cookie (so two accounts, or one
// account after a cookie rotation, never share an entry), holds only the JWT
// and its expiry, and is capped in size. A JWT whose `uid` claim names another
// account, or whose Clerk `sid` claim names another session, is refused; an
// absent claim is not a refusal. A revoked or ended session evicts the cache
// and answers `reauth`; nothing retries it.
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { resolveUcCredential, uidFromSessionJwt } from "../native-uc-tts/credentials.js";
import {
  UC_AUTH_SOURCES,
  UC_CREDENTIAL_FIELDS,
  UC_MAX_CACHED_ACCOUNTS,
  UC_MAX_JWT_LENGTH,
  UC_MAX_TOKEN_LIFETIME_MS,
  UC_REFRESH_SKEW_DEFAULT_MS,
  UC_REFRESH_SKEW_MAX_MS,
  UC_REFRESH_SKEW_MIN_MS,
  UC_REQUEST_TIMEOUT_MS,
  UC_SIGNIN_HTTP_STATUS,
  UC_SIGNIN_MESSAGES,
  isUcConsumerSignInEnabled,
} from "./config.js";
import { clerkErrorCode, ucClerkPost } from "./transport.js";

const SESSION_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const REVOKED_CODES = new Set(["authentication_invalid", "session_not_found", "session_revoked", "session_ended", "resource_not_found", "signed_out"]);

/** Failure result with its fixed message and dashboard status. */
export function ucFailure(kind, extra = {}) {
  return { ok: false, kind, message: UC_SIGNIN_MESSAGES[kind], httpStatus: UC_SIGNIN_HTTP_STATUS[kind], ...extra };
}

export const clampRefreshSkew = (value) =>
  Math.min(UC_REFRESH_SKEW_MAX_MS, Math.max(UC_REFRESH_SKEW_MIN_MS, isNumber(value) && Number.isFinite(value) ? value : UC_REFRESH_SKEW_DEFAULT_MS));

/** Claims of a session JWT (unverified decode, like the source's decodeJwtClaims), or null. */
export function sessionJwtClaims(jwt) {
  try {
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return isRecord(claims) ? claims : null;
  } catch {
    return null;
  }
}

/** `exp` claim of a session JWT in milliseconds (unverified decode), or null. */
export function expFromSessionJwt(jwt) {
  const claims = sessionJwtClaims(jwt);
  return claims && isNumber(claims.exp) && Number.isFinite(claims.exp) ? claims.exp * 1000 : null;
}

// Top-level `jwt`, else top-level `token` (clerkAuth.ts:128-131). Nothing else.
const jwtFrom = (body) => {
  const candidate = isString(body?.jwt) ? body.jwt : isString(body?.token) ? body.token : "";
  return candidate && candidate.length <= UC_MAX_JWT_LENGTH && SESSION_JWT.test(candidate) ? candidate : null;
};

/** Map a non-success Clerk answer for a session call. */
function sessionFailure(answer) {
  if (!answer.ok) return ucFailure(answer.kind, answer.status ? { status: answer.status } : {});
  const code = clerkErrorCode(answer.body);
  // clerkAuth.ts:85-87: 401/403 = the durable login is invalid -> re-login.
  if (answer.status === 401 || answer.status === 403 || answer.status === 404 || (code && REVOKED_CODES.has(code))) return ucFailure("reauth", { status: answer.status });
  if (answer.status === 429) return ucFailure("rate_limited", { status: 429, retryAfter: answer.retryAfter });
  return ucFailure("upstream", { status: answer.status });
}

/** Merge a Set-Cookie patch into one account's jar; an emptied cookie is dropped. */
export function mergeCookies(jar, patch) {
  const next = { ...jar };
  for (const [name, value] of Object.entries(patch ?? {})) {
    if (value === "") delete next[name];
    else next[name] = value;
  }
  return next;
}

/**
 * Mint one session JWT for one account. Never throws.
 *   { ok: true, jwt, uid, expiresAt, cookies }   `cookies` is the account's jar after Set-Cookie;
 *                                                `uid` is the JWT `uid` claim, null when absent
 *   failure result (see ucFailure)
 * A `uid` claim that names another account than `expectedUid`, or a `sid`
 * claim that names another session than `sid`, answers `identity`. An absent
 * claim is accepted, as in the source and the staged TTS mint.
 */
export async function mintUcSession(fetchImpl, { sid, cookies, expectedUid }, { signal, timeoutMs = UC_REQUEST_TIMEOUT_MS } = {}) {
  const answer = await ucClerkPost(fetchImpl, `/v1/client/sessions/${sid}/tokens`, { cookies, apiVersion: false, signal, timeoutMs });
  if (!answer.ok || answer.status !== 200) return sessionFailure(answer);
  const jwt = jwtFrom(answer.body);
  const claims = jwt ? sessionJwtClaims(jwt) : null;
  if (!claims) return ucFailure("malformed", { status: 200 });
  const claimed = uidFromSessionJwt(jwt);
  if (expectedUid && claimed && claimed !== expectedUid) return ucFailure("identity");
  if (claims.sid !== undefined && claims.sid !== sid) return ucFailure("identity");
  return { ok: true, jwt, uid: claimed, expiresAt: expFromSessionJwt(jwt), cookies: mergeCookies(cookies, answer.cookies) };
}

/**
 * Canonical providerSpecificData for one UC consumer account, or null when the
 * staged TTS credential resolver would not accept it. This is the only builder
 * of saved metadata: a result that fails here is never saved.
 */
export function buildUcConnectionMetadata({ clientCookie, sid, uid, cookies, source, now }) {
  if (!UC_AUTH_SOURCES.includes(source)) return null;
  const jar = { ...cookies };
  if (isString(clientCookie)) jar.__client = clientCookie;
  const metadata = {
    [UC_CREDENTIAL_FIELDS.clientCookie[0]]: clientCookie,
    [UC_CREDENTIAL_FIELDS.sid[0]]: sid,
    [UC_CREDENTIAL_FIELDS.uid[0]]: uid,
    [UC_CREDENTIAL_FIELDS.cookies[0]]: jar,
    ucAuthSource: source,
    ucSignedInAt: new Date(now).toISOString(),
  };
  const resolved = resolveUcCredential({ providerSpecificData: metadata });
  if (!resolved || resolved.clientCookie !== clientCookie || resolved.sid !== sid || resolved.uid !== uid) return null;
  if (Object.keys(resolved.cookies).length !== Object.keys(jar).length) return null;
  return metadata;
}

/** Changed jar -> metadata patch for that same connection, else null. */
function rotationPatch(credential, cookies) {
  const before = JSON.stringify(Object.entries(credential.cookies).sort());
  const after = JSON.stringify(Object.entries(cookies).sort());
  if (before === after || !cookies.__client) return null;
  return {
    [UC_CREDENTIAL_FIELDS.clientCookie[0]]: cookies.__client,
    [UC_CREDENTIAL_FIELDS.cookies[0]]: { ...cookies },
  };
}

const cacheKey = (credential) => `${credential.uid}\u0000${credential.sid}\u0000${createHash("sha256").update(credential.clientCookie).digest("hex")}`;

/**
 * Private per-account session controller. Every call reads only the
 * credentials it is given.
 *   getSessionToken(credentials, { signal }) -> { ok, jwt, expiresAt, cached, rotated } | failure
 *   forget(credentials)                       drops that account's cached JWT
 */
export function createUcSessionController({
  fetchImpl,
  env = process.env,
  now = Date.now,
  refreshSkewMs = UC_REFRESH_SKEW_DEFAULT_MS,
  timeoutMs = UC_REQUEST_TIMEOUT_MS,
  maxCachedAccounts = UC_MAX_CACHED_ACCOUNTS,
} = {}) {
  const skew = clampRefreshSkew(refreshSkewMs);
  const cap = Math.max(1, Math.min(UC_MAX_CACHED_ACCOUNTS, maxCachedAccounts));
  const cache = new Map();

  const guard = (credentials) => {
    if (!isUcConsumerSignInEnabled(env)) return { failure: ucFailure("disabled") };
    const credential = resolveUcCredential(credentials);
    return credential ? { credential } : { failure: ucFailure("invalid_credential") };
  };

  const remember = (key, entry) => {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > cap) cache.delete(cache.keys().next().value);
  };

  async function mintFresh(credential, key, signal) {
    const minted = await mintUcSession(fetchImpl, { sid: credential.sid, cookies: credential.cookies, expectedUid: credential.uid }, { signal, timeoutMs });
    if (!minted.ok) {
      if (minted.kind === "reauth" || minted.kind === "identity") cache.delete(key);
      return minted;
    }
    const issuedAt = now();
    const expiresAt = Math.min(minted.expiresAt ?? issuedAt, issuedAt + UC_MAX_TOKEN_LIFETIME_MS);
    if (expiresAt - issuedAt > skew) remember(key, { jwt: minted.jwt, expiresAt });
    return { ok: true, jwt: minted.jwt, expiresAt, cached: false, rotated: rotationPatch(credential, minted.cookies) };
  }

  return Object.freeze({
    async getSessionToken(credentials, { signal } = {}) {
      const { credential, failure } = guard(credentials);
      if (failure) return failure;
      const key = cacheKey(credential);
      const hit = cache.get(key);
      if (hit && hit.expiresAt - now() > skew) return { ok: true, jwt: hit.jwt, expiresAt: hit.expiresAt, cached: true, rotated: null };
      cache.delete(key);
      return mintFresh(credential, key, signal);
    },
    forget(credentials) {
      const credential = resolveUcCredential(credentials);
      if (credential) cache.delete(cacheKey(credential));
    },
    get cachedAccounts() {
      return cache.size;
    },
  });
}
