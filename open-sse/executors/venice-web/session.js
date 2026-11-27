// Clerk session lookup and short-lived session JWT, ported from OmniRoute
// open-sse/executors/venice-web-auth.ts (MIT). The `__client` cookie is sent
// only here, and only to clerk.venice.ai.
import { digestMemoryKey } from "../../utils/memoryKey.js";
import { cancelDiscardedResponse } from "../sendRequest.js";
import { isQuotaDispatchUnavailable } from "../../services/quota/dispatch.js";
import { VENICE_WEB_CLIENT_URL, VENICE_WEB_ORIGIN, veniceWebTokenUrl } from "../../providers/registry/venice-web.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { decodeVeniceJwt, jwtExpiryMs } from "./credential.js";
import { expiredSession, httpFailure, isAbort, isRedirect, malformedReply, transportFailure } from "./errors.js";

export const VENICE_WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const EXPIRY_BUFFER_MS = 10_000;
const DEFAULT_TTL_MS = 55_000;
const CACHE_MAX_ENTRIES = 100;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

const clerkHeaders = (clientJwt) => ({
  Cookie: `__client=${clientJwt}`,
  "Content-Type": "application/json",
  "User-Agent": VENICE_WEB_USER_AGENT,
  Origin: VENICE_WEB_ORIGIN,
});

async function clerkRequest(url, method, clientJwt, send, signal, stage) {
  let response;
  try {
    response = await send(url, { method, headers: clerkHeaders(clientJwt), redirect: "manual", signal });
  } catch (error) {
    if (isQuotaDispatchUnavailable(error)) throw error;
    throw transportFailure(error, signal);
  }
  if (!response.ok || isRedirect(response)) {
    cancelDiscardedResponse(response);
    throw httpFailure(response, stage, { signIn: true });
  }
  return response.json().catch((error) => {
    if (isAbort(error, signal)) throw error;
    throw malformedReply(`an unreadable ${stage} reply`);
  });
}

/** The active Clerk session of this cookie. A read-only GET. */
export async function findVeniceSessionId(clientJwt, send, signal) {
  const body = await clerkRequest(VENICE_WEB_CLIENT_URL, "GET", clientJwt, send, signal, "session lookup");
  // Clerk answers `response: null` for a cookie that no longer names a client.
  const sessions = body?.response === null ? [] : body?.response?.sessions;
  if (!Array.isArray(sessions)) throw malformedReply("an unreadable session lookup reply");
  const active = sessions.find((session) => session?.status === "active");
  if (!active) throw expiredSession();
  // The id becomes a path segment of a request that carries the cookie.
  if (!isString(active.id) || !SESSION_ID.test(active.id)) throw malformedReply("an invalid session id");
  return active.id;
}

async function mintSessionToken(clientJwt, send, signal) {
  const sessionId = await findVeniceSessionId(clientJwt, send, signal);
  const body = await clerkRequest(veniceWebTokenUrl(sessionId), "POST", clientJwt, send, signal, "session token request");
  const jwt = body?.jwt;
  const claims = decodeVeniceJwt(jwt);
  if (!claims || !isString(claims.sub) || !claims.sub) throw malformedReply("an invalid session token");
  const expiresAt = jwtExpiryMs(claims);
  if (expiresAt && expiresAt <= Date.now()) throw malformedReply("an expired session token");
  return { jwt, userId: claims.sub, expiresAt: expiresAt || Date.now() + DEFAULT_TTL_MS };
}

/**
 * A per-executor cache of session tokens, keyed by a digest of the whole cookie
 * and the connection's proxy settings. Clerk cookies share their first bytes, so
 * a prefix key would give one account another account's token. Concurrent cold
 * requests each mint their own token: sharing one pending request would let one
 * caller's abort fail the others.
 */
export function createVeniceSessions() {
  const entries = new Map();
  return {
    async token({ clientJwt, proxyOptions, send, signal }) {
      const key = digestMemoryKey("venice-web-session", clientJwt, JSON.stringify(proxyOptions ?? null));
      const cached = entries.get(key);
      if (cached && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS) return cached;
      entries.delete(key);
      const minted = { key, ...await mintSessionToken(clientJwt, send, signal) };
      if (Date.now() < minted.expiresAt - EXPIRY_BUFFER_MS) {
        entries.set(key, minted);
        if (entries.size > CACHE_MAX_ENTRIES) entries.delete(entries.keys().next().value);
      }
      return minted;
    },
    /** Drop a rejected token, unless a newer one already replaced it. */
    forget(session) {
      if (entries.get(session.key)?.jwt === session.jwt) entries.delete(session.key);
    },
  };
}
