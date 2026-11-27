/**
 * Staged device-response validation adapted from OmniRoute (MIT),
 * src/lib/oauth/providers/museCodeDeviceResponse.ts at b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523.
 */
import { isNumber, isRecord, isString } from "../../../../shared/utils/typeChecks.js";
import { MUSE_CODE_DEFAULT_POLL_INTERVAL_SEC, museCodeHeaders } from "../../../../../open-sse/config/museCode.js";

const errors = {
  authorization_pending: "Authorization pending.",
  slow_down: "Authorization pending.",
  access_denied: "Authorization denied.",
  expired_token: "Device code expired.",
  invalid_grant: "Authorization failed."
};

function record(value) {
  return isRecord(value) ? value : {};
}

function required(value, field) {
  if (!isString(value) || !value.trim()) throw new Error(`Muse Code device authorization response missing ${field}`);
  return value.trim();
}

function authorizationUrl(value) {
  if (value === undefined || value === "") return "";
  try {
    if (!isString(value)) throw new Error();
    const url = new URL(value);
    if (url.origin !== "https://auth.meta.com" || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new Error("Muse Code returned an invalid authorization URL.");
  }
}

/** Validate data before showing a device authorization link to a user. */
export function normalizeMuseDeviceResponse(value) {
  const data = record(value);
  const verification = authorizationUrl(data.verification_uri);
  const complete = authorizationUrl(data.verification_uri_complete);
  if (!verification && !complete) throw new Error("Muse Code returned an invalid authorization URL.");
  if (!isNumber(data.expires_in) || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400) {
    throw new Error("Muse Code returned an invalid device code expiry.");
  }
  const interval = Number(data.interval);
  return {
    device_code: required(data.device_code, "device_code"),
    user_code: required(data.user_code, "user_code"),
    verification_uri: verification,
    verification_uri_complete: complete,
    expires_in: data.expires_in,
    interval: Number.isFinite(interval) && interval > 0 ? interval : MUSE_CODE_DEFAULT_POLL_INTERVAL_SEC
  };
}

/** Whitelist poll fields and messages; never propagate an upstream error body. */
export function normalizeMusePollResponse(value, ok) {
  const data = record(value);
  if (ok && isString(data.access_token) && data.access_token.trim()) {
    const result = { access_token: data.access_token.trim() };
    if (isNumber(data.expires_in) && Number.isFinite(data.expires_in)) result.expires_in = data.expires_in;
    if (isString(data.token_type)) result.token_type = data.token_type;
    return result;
  }
  if (isString(data.error) && Object.hasOwn(errors, data.error)) {
    return { error: data.error, error_description: errors[data.error] };
  }
  return { error: "invalid_response" };
}

/** Guard OAuth route modes for this device-only provider before any upstream call. */
export function assertMuseOAuthAction(action) {
  if (!["device-code", "poll", "cancel"].includes(action)) {
    throw new Error("Muse Code supports device authorization only.");
  }
}

/** Bounded form transport for integration into the existing Muse provider adapter. */
export async function postMuseDeviceForm(url, params, proxyOptions, signal) {
  const deadline = AbortSignal.timeout(20000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: requestSignal,
      headers: museCodeHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams(params),
      proxyOptions
    });
    const data = record(await response.json().catch(() => null));
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: { error: "network_error" } };
  }
}
