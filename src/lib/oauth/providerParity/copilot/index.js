import { isNumber, isRecord, isString } from "../../../../shared/utils/typeChecks.js";

const DEVICE_ERRORS = new Set([
  "authorization_pending", "slow_down", "expired_token", "access_denied",
  "incorrect_device_code", "incorrect_client_credentials", "device_flow_disabled", "unsupported_grant_type"
]);

/** Decode only fields used by the existing GitHub device-flow handler. */
export function decodeCopilotPollResponse(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: "invalid_response" }; }
  if (!isRecord(data)) return { error: "invalid_response" };
  if (isString(data.error)) return { error: DEVICE_ERRORS.has(data.error) ? data.error : "invalid_response" };
  if (!isString(data.access_token) || !data.access_token) return { error: "invalid_response" };
  const result = { access_token: data.access_token };
  for (const key of ["refresh_token", "token_type", "scope"]) {
    if (isString(data[key])) result[key] = data[key];
  }
  if (isNumber(data.expires_in)) result.expires_in = data.expires_in;
  return result;
}
