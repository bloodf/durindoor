import { isFunction, isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { readBoundedResponseText } from "../../utils/error.js";
import { requestAbortError } from "../../executors/sendRequest.js";
import { dedupRefresh } from "./dedup.js";

function resolveCallerSignal(options) {
  if (!options || !isObject(options)) return null;
  if ("aborted" in options && isFunction(options.addEventListener)) return options;
  return options.signal ?? null;
}

function waitCallerAbort(operation, signal) {
  if (!signal) return operation;
  const pending = Promise.resolve(operation);
  if (signal.aborted) {
    pending.catch(() => {});
    return Promise.reject(requestAbortError(signal.reason));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener?.("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, requestAbortError(signal.reason));
    signal.addEventListener?.("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        if (signal.aborted) finish(reject, requestAbortError(signal.reason));
        else finish(resolve, value);
      },
      (error) => finish(reject, error)
    );
  });
}

/**
 * Exchange a Cursor refresh token, retaining it when the response does not rotate it.
 *
 * Accepts an optional `options` (`{ signal }` or bare `AbortSignal`) so caller
 * waits reject promptly on pre-abort or mid-flight/backoff abort while the
 * shared `dedupRefresh` exchange continues safely for concurrent callers.
 */
export async function refreshCursorToken(token, log, proxyOptions = null, options = null) {
  const callerSignal = resolveCallerSignal(options);
  if (callerSignal?.aborted) throw requestAbortError(callerSignal.reason);
  if (!token) return null;
  const operation = dedupRefresh("cursor", token, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const signal = AbortSignal.timeout(15000);
        const response = await proxyAwareFetch("https://api2.cursor.sh/auth/exchange_user_api_key", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: "{}", redirect: "error", signal,
        }, proxyOptions);
        if (response.ok) {
          const text = await readBoundedResponseText(response, { signal, throwOnTimeout: true });
          if (!text) return null;
          const data = JSON.parse(text);
          if (!isString(data?.accessToken) || !data.accessToken) return null;
          let expiry = Date.now() + 3600000;
          try {
            const payload = JSON.parse(Buffer.from(data.accessToken.split(".")[1], "base64url").toString());
            if (isNumber(payload.exp) && Number.isFinite(payload.exp)) expiry = payload.exp * 1000;
          } catch { /* opaque access token */ }
          return { accessToken: data.accessToken, refreshToken: isString(data.refreshToken) && data.refreshToken ? data.refreshToken : token, expiresAt: new Date(expiry).toJSON() ?? new Date(Date.now() + 3600000).toISOString() };
        }
        void response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) return { error: "unrecoverable_refresh_error", code: "unauthorized" };
        if (![429, 500, 502, 503, 504].includes(response.status)) return null;
      } catch { /* retry transient failures */ }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, Math.floor(300 * 2 ** attempt * (0.8 + Math.random() * 0.4))));
    }
    log?.error?.("TOKEN_REFRESH", "Cursor token refresh failed");
    return null;
  }, log, proxyOptions);
  return waitCallerAbort(operation, callerSignal);
}
