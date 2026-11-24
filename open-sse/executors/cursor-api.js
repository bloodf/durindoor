// Cursor API-key executor (staged, unverified against a live account).
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/services/cursorApiKeyAuth.ts and the `cursor-api` branch of
// open-sse/executors/cursor.ts. api2.cursor.sh rejects a raw `crsr_...` key as a
// Bearer credential, so the key is POSTed to /auth/exchange_user_api_key for a
// one-hour session JWT. The returned refresh token carries the same expiry, so
// "refresh" means re-exchanging the key. Chat itself reuses the existing Cursor
// request path (CursorExecutor) untouched.
//
// Safety posture:
//  - Dispatch is off unless the connection sets
//    `providerSpecificData.enableSessionDispatch === true`.
//  - Session tokens are cached per API key (HMAC fingerprint, never the key), so
//    two connections never share a session token.
//  - Error bodies never echo the key or the upstream body.
import crypto from "node:crypto";
import { CursorExecutor } from "./cursor.js";
import { PROVIDERS } from "../config/providers.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { errorResponse } from "../utils/error.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { credentialFetch } from "../utils/credentialFetch.js";
import { resolveCursorModels } from "../services/cursorModels.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

export const CURSOR_API_BASE_URL = "https://api2.cursor.sh";
export const CURSOR_API_KEY_PREFIXES = Object.freeze(["crsr_", "grok_"]);
export const CURSOR_API_KEY_EXCHANGE_URL = `${CURSOR_API_BASE_URL}/auth/exchange_user_api_key`;
export const CURSOR_API_OPT_IN_KEY = "enableSessionDispatch";

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 55 * 60 * 1000;
const EXCHANGE_TIMEOUT_MS = 15_000;
const MAX_SESSIONS = 200;

function cancelBody(response) {
  try {
    const cancellation = response?.body?.cancel?.();
    cancellation?.catch?.(() => {});
  } catch {}
}

function raceWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException("The operation was aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException("The operation was aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export class CursorApiError extends Error {
  constructor(status, code, message, type = null) {
    super(message);
    this.name = "CursorApiError";
    this.status = status;
    this.code = code;
    this.type = type;
  }
}

export function isCursorApiKey(value) {
  return isString(value) && CURSOR_API_KEY_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function isCursorApiDispatchEnabled(credentials) {
  return credentials?.providerSpecificData?.[CURSOR_API_OPT_IN_KEY] === true;
}

// Domain-separated digest used only as a map key; never stored or logged.
function fingerprint(apiKey) {
  return crypto.createHmac("sha256", "durindoor-cursor-api-session-cache-v1").update(apiKey).digest("hex");
}

/** Stable per-key machine id for the checksum header, unless the connection pins one. */
export function deriveCursorApiMachineId(apiKey) {
  return crypto.createHash("sha256").update(`cursor-api:machine:${apiKey}`).digest("hex");
}

export function readJwtExpiryMs(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function parseExchangeBody(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CursorApiError(502, "cursor_api_exchange_invalid", "Cursor API key exchange returned a non-JSON body");
  }
  if (!isObject(parsed)) throw new CursorApiError(502, "cursor_api_exchange_invalid", "Cursor API key exchange returned an empty body");
  const { accessToken, refreshToken } = parsed;
  if (!isString(accessToken) || !accessToken) {
    throw new CursorApiError(502, "cursor_api_exchange_invalid", "Cursor API key exchange returned no accessToken");
  }
  return { accessToken, refreshToken: isString(refreshToken) && refreshToken ? refreshToken : null };
}

function errorBodyResponse(error) {
  const type = error.type || (error.status === HTTP_STATUS.UNAUTHORIZED ? "authentication_error"
    : error.status === HTTP_STATUS.RATE_LIMITED ? "rate_limit_error" : "provider_error");
  return errorResponse(error.status, error.message, { type, code: error.code }, error.retryAfterSec || null);
}

/**
 * Credential and quota mapping shared by the exchange and the chat path:
 * 401/403 -> 401 authentication_error, 429 -> 429 rate_limit_error.
 */
function mapStatus(status, subject) {
  if (status === 401 || status === 403) {
    return new CursorApiError(401, "cursor_api_key_rejected", `Cursor rejected the API key (${subject}).`, "authentication_error");
  }
  if (status === 429) {
    return new CursorApiError(429, "cursor_api_rate_limited", `Cursor rate limit or quota reached (${subject}).`, "rate_limit_error");
  }
  return null;
}

export class CursorApiExecutor extends CursorExecutor {
  /**
   * @param {{ fetchImpl?: Function, now?: () => number }} [options] Injectable
   *   for tests; production uses the proxy-aware transport.
   */
  constructor({ fetchImpl = null, now = Date.now } = {}) {
    super();
    this.provider = "cursor-api";
    this.config = PROVIDERS["cursor-api"] || this.config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sessions = new Map();
    this.inflight = new Map();
  }

  async #exchange(apiKey, { proxyOptions } = {}) {
    if (!isCursorApiKey(apiKey)) {
      throw new CursorApiError(400, "cursor_api_key_format", `Cursor API keys start with ${CURSOR_API_KEY_PREFIXES.join(" or ")}.`, "invalid_request_error");
    }
    const timeout = AbortSignal.timeout(EXCHANGE_TIMEOUT_MS);
    const init = {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: "{}",
      signal: timeout,
    };
    let response;
    try {
      const fetcher = this.fetchImpl
        ? (url, options) => this.fetchImpl(url, options, proxyOptions)
        : (url, options) => proxyAwareFetch(url, options, proxyOptions);
      response = await credentialFetch(fetcher, CURSOR_API_KEY_EXCHANGE_URL, init);
    } catch (error) {
      if (error?.name === "AbortError" && signal?.aborted) throw error;
      throw new CursorApiError(502, "cursor_api_exchange_failed", "Cursor API key exchange request failed");
    }
    const mapped = mapStatus(response.status, "key exchange");
    if (mapped) {
      cancelBody(response);
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      if (mapped.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) mapped.retryAfterSec = retryAfter;
      throw mapped;
    }
    if (!response.ok) {
      cancelBody(response);
      throw new CursorApiError(response.status >= 500 ? 502 : response.status, "cursor_api_exchange_failed",
        `Cursor API key exchange failed with HTTP ${response.status}`);
    }
    const { accessToken, refreshToken } = parseExchangeBody(await response.text());
    return { accessToken, refreshToken, expiresAt: readJwtExpiryMs(accessToken) ?? this.now() + FALLBACK_TTL_MS };
  }

  /** Session token for one API key; one live exchange per key, cached until 5 minutes before expiry. */
  async resolveSession(apiKey, options = {}) {
    const key = fingerprint(String(apiKey));
    const cached = this.sessions.get(key);
    if (cached && cached.expiresAt - REFRESH_SKEW_MS > this.now()) return raceWithSignal(Promise.resolve(cached), options.signal);
    const pending = this.inflight.get(key);
    if (pending) return raceWithSignal(pending, options.signal);
    const exchange = this.#exchange(apiKey, options)
      .then((token) => {
        const now = this.now();
        for (const [sessionKey, session] of this.sessions) {
          if (session.expiresAt - REFRESH_SKEW_MS <= now) this.sessions.delete(sessionKey);
        }
        this.sessions.delete(key);
        this.sessions.set(key, token);
        while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value);
        return token;
      })
      .finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, exchange);
    return raceWithSignal(exchange, options.signal);
  }

  invalidateSession(apiKey) {
    if (isString(apiKey)) this.sessions.delete(fingerprint(apiKey));
  }

  /** Token refresh is a forced re-exchange of the key (the refresh token shares the session's `exp`). */
  async refreshCredentials(credentials, log, proxyOptions = null) {
    // chatCore also refreshes after our own 403 for a disabled connection; that
    // must not turn into a key exchange.
    if (!isCursorApiDispatchEnabled(credentials) || !isCursorApiKey(credentials?.apiKey)) return null;
    this.invalidateSession(credentials.apiKey);
    try {
      const session = await this.resolveSession(credentials.apiKey, { proxyOptions });
      return {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: Math.max(1, Math.floor((session.expiresAt - this.now()) / 1000)),
      };
    } catch (error) {
      log?.warn?.("CURSOR-API", `session refresh failed: ${error?.code || error?.message}`);
      return null;
    }
  }

  needsRefresh() {
    // The key never expires on its own and the session cache re-exchanges before every dispatch.
    return false;
  }

  #fail(error) {
    const failure = error instanceof CursorApiError ? error
      : new CursorApiError(502, "cursor_api_error", "Cursor API request failed");
    return {
      response: errorBodyResponse(failure),
      url: CURSOR_API_KEY_EXCHANGE_URL,
      headers: {},
      transformedBody: null,
    };
  }

  async execute(args) {
    const { credentials, signal, proxyOptions = null } = args;
    if (!isCursorApiDispatchEnabled(credentials)) {
      return this.#fail(new CursorApiError(403, "cursor_api_dispatch_disabled",
        `Cursor API session dispatch is disabled for this connection. Set providerSpecificData.${CURSOR_API_OPT_IN_KEY} to true to opt in.`,
        "permission_error"));
    }
    let session;
    try {
      session = await this.resolveSession(credentials?.apiKey, { signal, proxyOptions });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return this.#fail(error);
    }
    const providerSpecificData = {
      ...credentials.providerSpecificData,
      machineId: credentials.providerSpecificData?.machineId || deriveCursorApiMachineId(credentials.apiKey),
    };
    const result = await super.execute({
      ...args,
      credentials: { ...credentials, accessToken: session.accessToken, providerSpecificData },
    });
    return this.#mapUpstreamError(result, credentials.apiKey);
  }

  /** Cursor answers credential and quota failures with generic 401/429 bodies; give them structured types. */
  #mapUpstreamError(result, apiKey) {
    const original = result?.response;
    const status = original?.status;
    if (!original || original.ok) return result;
    if (status === HTTP_STATUS.UNAUTHORIZED) this.invalidateSession(apiKey);
    const mapped = mapStatus(status, "chat");
    if (!mapped) return result;
    const response = errorBodyResponse(mapped);
    cancelBody(original);
    transferProviderAttemptDispatch(original, response);
    return { ...result, response };
  }
}

/**
 * Model discovery for a `cursor-api` connection: exchange the key, then read the
 * account's live catalog through the existing Cursor resolver. Falls back to the
 * static catalog (with a warning) when the live list is empty.
 */
export async function discoverCursorApiModels(connection, { executor, proxyOptions = null, signal, log = console, staticModels = [] } = {}) {
  const apiKey = connection?.apiKey;
  const runner = executor || new CursorApiExecutor();
  const session = await runner.resolveSession(apiKey, { signal, proxyOptions });
  const providerSpecificData = {
    ...connection.providerSpecificData,
    machineId: connection.providerSpecificData?.machineId || deriveCursorApiMachineId(apiKey),
  };
  const result = await resolveCursorModels({ accessToken: session.accessToken, providerSpecificData }, { forceRefresh: true, log, proxyOptions, signal });
  if (result?.models?.length) return { models: result.models.map((model) => ({ id: model.id, name: model.name })) };
  return { models: staticModels, warning: "Cursor returned no live models; falling back to static catalog." };
}

export default CursorApiExecutor;
