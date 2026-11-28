// Private source-session import, not a site-cookie or page-storage parser.
import { resolveMaxaiCredential, maxaiUserIdFromJwt } from "../../../executors/maxaiCredentials.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";

export const safeValue = (v) => isString(v) && v.length > 0 && v.length <= 8192 && !/[\r\n\0]/.test(v);
export const failure = (error, status = 0) => ({ ok: false, status, error });

/** Unverified JWT expiry metadata, epoch seconds; never an invented lifetime. */
export function accessTokenExpiry(token) {
  try {
    const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp;
    return Number.isFinite(exp) && exp > 0 ? exp : undefined;
  } catch { return undefined; }
}

function alias(data, keys) {
  const values = keys.filter((key) => data[key] !== undefined).map((key) => data[key]);
  if (values.some((v) => !safeValue(v)) || new Set(values).size > 1) throw new Error();
  return values[0];
}

/**
 * Accept complete source credential objects or exported connection objects, as
 * JSON/object. Never combine a pasted partial session with an existing account.
 * Legacy source PSD refresh tokens are migrated to the top level on output.
 */
export function normalizeMaxaiSession(input) {
  try {
    if (isString(input)) {
      if (Buffer.byteLength(input) > 65536) return failure("invalid_session");
      input = JSON.parse(input);
    }
    if (!isRecord(input) || input.cookie !== undefined || (input.apiKey !== undefined && input.providerSpecificData === undefined)) return failure("invalid_session");
    let token, deviceId, userId, refreshToken;
    if (input.providerSpecificData !== undefined) {
      if (!isRecord(input.providerSpecificData)) return failure("invalid_session");
      const data = input.providerSpecificData;
      const max = ["maxaiAccessToken", "maxaiDeviceId", "maxaiUserId"].some((k) => data[k] !== undefined);
      token = alias(data, max ? ["maxaiAccessToken"] : ["accessToken"]);
      const top = alias(input, ["accessToken", "apiKey"]);
      if (top !== undefined) {
        if (top.includes(";") || (token && token !== top)) return failure("invalid_session");
        token = top;
      }
      deviceId = alias(data, max ? ["maxaiDeviceId"] : ["deviceId"]);
      userId = alias(data, max ? ["maxaiUserId"] : ["userId"]);
      // Existing encrypted top-level refreshToken is authoritative, including
      // invalid/empty values: never silently resurrect a stale PSD secret.
      refreshToken = input.refreshToken !== undefined ? input.refreshToken : alias(data, ["maxaiRefreshToken", "refreshToken"]);
    } else {
      token = alias(input, ["accessToken", "access_token"]);
      deviceId = alias(input, ["deviceId"]);
      userId = alias(input, ["userId", "user_id"]);
      refreshToken = alias(input, ["refreshToken", "refresh_token"]);
    }
    // Source firstString handles a JSON-quoted device ID. No storage key is inferred.
    if (isString(deviceId) && deviceId.startsWith('"') && deviceId.endsWith('"')) deviceId = JSON.parse(deviceId);
    const tuple = resolveMaxaiCredential({ accessToken: token, providerSpecificData: { deviceId, userId } });
    if (!tuple.ok || (refreshToken !== undefined && !safeValue(refreshToken))) return failure("invalid_session");
    const refreshUser = refreshToken && maxaiUserIdFromJwt(refreshToken);
    if (refreshUser && refreshUser !== tuple.userId) return failure("invalid_session");
    const result = { ok: true, accessToken: tuple.token, deviceId: tuple.deviceId, userId: tuple.userId };
    if (refreshToken !== undefined) result.refreshToken = refreshToken;
    const expiry = accessTokenExpiry(tuple.token);
    if (expiry !== undefined) result.expiresAt = expiry;
    return result;
  } catch { return failure("invalid_session"); }
}

/** Explicit secret export for a user's manual transfer; never a public response. */
export function exportMaxaiSession(input) {
  const session = normalizeMaxaiSession(input);
  if (!session.ok) return session;
  const { accessToken, deviceId, userId, refreshToken } = session;
  return { ok: true, json: JSON.stringify({ accessToken, deviceId, userId, refreshToken }) };
}
