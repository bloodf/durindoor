import { isFunction, isNumber, isRecord, isString } from "../../../../shared/utils/typeChecks.js";

/**
 * Staged Grok CLI sign-in mode guard, device polling lifecycle and auth.json
 * paste validation. Not registered in production.
 *
 * Polling semantics follow CLIProxyAPI internal/auth/xai/xai.go and types.go at
 * dbe641f286a489ecb39e3c041c554371e6add864 (MIT): poll once immediately, at
 * least 5 s between attempts, slow_down adds 5 s, deadline is the earlier of
 * expires_in and 30 minutes, expired_token and access_denied are terminal.
 * Paste validation follows OmniRoute src/lib/oauth/utils/grokCliAuthJson.ts at
 * b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523 (MIT).
 */
export const GROK_SIGNIN_MODES = Object.freeze(["device", "browser", "import"]);
export const GROK_MIN_POLL_INTERVAL_MS = 5000;
export const GROK_SLOW_DOWN_STEP_MS = 5000;
export const GROK_MAX_POLL_DURATION_MS = 30 * 60 * 1000;

/** Reject unknown sign-in modes before any network request. */
export function assertGrokSignInMode(mode) {
  if (!GROK_SIGNIN_MODES.includes(mode)) throw new Error("Unsupported Grok sign-in mode");
  return mode;
}

function abortError() {
  const error = new Error("Grok device authorization aborted");
  error.name = "AbortError";
  return error;
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * Drive a device-code authorization to completion.
 * `poll(deviceCode)` is the production provider transport, for example
 * `(code) => getProvider("grok-cli").pollToken(config, code, null, null, proxyOptions)`.
 * Returns the token payload once; no request is sent after a token is accepted.
 */
export async function pollGrokDeviceAuthorization({ poll, deviceCode, interval, expiresIn, signal, now = Date.now, sleep = defaultSleep }) {
  if (!isFunction(poll) || !isString(deviceCode) || !deviceCode) throw new Error("Invalid Grok device authorization");
  if (signal?.aborted) throw abortError();
  let waitMs = Math.max(GROK_MIN_POLL_INTERVAL_MS, isNumber(interval) && interval > 0 ? interval * 1000 : 0);
  const start = now();
  const codeWindow = isNumber(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : GROK_MAX_POLL_DURATION_MS;
  const deadline = start + Math.min(codeWindow, GROK_MAX_POLL_DURATION_MS);
  for (let first = true;; first = false) {
    if (!first) {
      await sleep(waitMs, signal);
      if (signal?.aborted) throw abortError();
      if (now() > deadline) throw new Error("Grok device code expired");
    }
    const result = await poll(deviceCode);
    if (signal?.aborted) throw abortError();
    const data = isRecord(result?.data) ? result.data : {};
    if (isString(data.access_token) && data.access_token.trim()) return data;
    switch (data.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        waitMs += GROK_SLOW_DOWN_STEP_MS;
        continue;
      case "expired_token":
        throw new Error("Grok device code expired");
      case "access_denied":
        throw new Error("Grok device authorization denied");
      default: {
        const code = isString(data.error) && /^[a-z][a-z0-9_]{0,63}$/.test(data.error) ? data.error : "invalid_response";
        throw new Error(`Grok device authorization failed: ${code}`);
      }
    }
  }
}

function hasJwt(value) {
  return isString(value) && value.startsWith("eyJ") && value.split(".").length === 3;
}

/**
 * Validate a pasted ~/.grok/auth.json. A bare JWT is rejected because it cannot
 * refresh. Returns the parsed document plus the selectable account keys (no tokens).
 */
export function parseGrokAuthJsonPaste(raw) {
  const trimmed = isString(raw) ? raw.trim() : "";
  if (!trimmed.startsWith("{")) {
    throw new Error(trimmed.startsWith("eyJ") ?
      "Paste the full ~/.grok/auth.json so the refresh token is included" :
      "Paste the full contents of ~/.grok/auth.json");
  }
  let doc;
  try {
    doc = JSON.parse(trimmed);
  } catch {
    throw new Error("Could not parse auth.json");
  }
  if (!isRecord(doc)) throw new Error("auth.json must be a JSON object");
  const accounts = Object.keys(doc).filter((key) => isRecord(doc[key]) && hasJwt(doc[key].key));
  if (accounts.length === 0) throw new Error("auth.json has no Grok account token");
  const refreshable = accounts.filter((key) => isString(doc[key].refresh_token) && doc[key].refresh_token.length > 0);
  if (refreshable.length === 0) throw new Error("auth.json is missing refresh_token; run grok login again");
  return { doc, accounts: refreshable };
}
