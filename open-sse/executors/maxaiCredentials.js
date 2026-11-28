// MaxAI chat credential tuple (#2034).
//
// A MaxAI request is signed for one account: the Bearer access token, the device ID
// sealed into X-Authorization, and the user ID bound into the proof. The three must
// come from the same source. This module picks that source once per call and never
// fills a missing member from another source.
//
// Precedence:
//   1. The stored cookie header (`cookie`, else `apiKey`) when it carries `access_token`.
//      Token, `device_id` and `user_id` all come from that header; the user ID may be
//      read from the same token's JWT subject when the header has no `user_id`.
//      providerSpecificData is not consulted for any member.
//   2. Otherwise the legacy providerSpecificData tuple, used only when complete:
//      the `maxai*` family when any `maxai*` member is set, else the plain family
//      (`accessToken` / top-level `accessToken`, `deviceId`, `userId`).
// Incomplete, conflicting or header-unsafe material resolves to a refusal, so the
// caller can fail before any billed send. Nothing is cached between calls.
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const MAX_VALUE_LENGTH = 8192;
const COOKIE_KEYS = ["access_token", "device_id", "user_id"];

const headerSafe = (value) => isString(value) && value.length > 0 && value.length <= MAX_VALUE_LENGTH && !/[\r\n\0]/.test(value);
const present = (value) => isString(value) && value.trim() !== "";

/**
 * Parse a Cookie header into the three MaxAI names. A name that appears more than
 * once with different values is reported as a conflict instead of picking one.
 * @param {unknown} source
 * @returns {{ jar: Record<string, string>, conflict: boolean }}
 */
function parseMaxaiCookie(source) {
  const jar = {};
  let conflict = false;
  if (!isString(source) || !source.includes("=")) return { jar, conflict };
  for (const part of source.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!COOKIE_KEYS.includes(key) || !value) continue;
    if (key in jar && jar[key] !== value) conflict = true;
    else jar[key] = value;
  }
  return { jar, conflict };
}

/**
 * User ID from the access JWT subject (`subject.user_id`, then `sub`), or "".
 * @param {string} token
 */
export function maxaiUserIdFromJwt(token) {
  try {
    const claims = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    const id = claims?.subject?.user_id || claims?.sub;
    return isString(id) ? id : "";
  } catch {
    return "";
  }
}

const refuse = (reason) => ({ ok: false, reason });

function complete(source, token, deviceId, userId) {
  const jwtUser = maxaiUserIdFromJwt(token);
  // A token whose own subject names a different user cannot be signed for userId.
  if (userId && jwtUser && userId !== jwtUser) return refuse("conflict");
  const user = userId || jwtUser;
  if (!token || !deviceId || !user) return refuse("incomplete");
  if (!headerSafe(token) || !headerSafe(deviceId) || !headerSafe(user)) return refuse("unsafe");
  return { ok: true, source, token, deviceId, userId: user };
}

function fromCookie(credentials) {
  const cookie = parseMaxaiCookie(credentials?.cookie);
  const apiKey = parseMaxaiCookie(credentials?.apiKey);
  const primary = cookie.jar.access_token ? cookie : apiKey.jar.access_token ? apiKey : null;
  if (!primary) return null;
  if (primary.conflict) return refuse("conflict");
  // Two stored headers naming different accounts: refuse rather than guess.
  if (cookie.jar.access_token && apiKey.jar.access_token && cookie.jar.access_token !== apiKey.jar.access_token) return refuse("conflict");
  const { access_token: token, device_id: deviceId = "", user_id: userId = "" } = primary.jar;
  return complete("cookie", token, deviceId, userId);
}

function fromProviderSpecificData(credentials) {
  const data = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : {};
  if (present(data.maxaiAccessToken) || present(data.maxaiDeviceId) || present(data.maxaiUserId)) {
    return complete("providerSpecificData", data.maxaiAccessToken || "", data.maxaiDeviceId || "", data.maxaiUserId || "");
  }
  const saved = present(data.accessToken) ? data.accessToken : "";
  const top = present(credentials?.accessToken) ? credentials.accessToken : "";
  if (saved && top && saved !== top) return refuse("conflict");
  const token = saved || top;
  if (!token && !present(data.deviceId) && !present(data.userId)) return refuse("missing");
  return complete("providerSpecificData", token, data.deviceId || "", data.userId || "");
}

/**
 * Resolve the MaxAI account tuple for one chat request or session probe.
 * The result never carries values from two sources.
 * @param {object} credentials the selected connection's credentials
 * @returns {{ ok: true, source: "cookie" | "providerSpecificData", token: string, deviceId: string, userId: string }
 *   | { ok: false, reason: "missing" | "incomplete" | "conflict" | "unsafe" }}
 */
export function resolveMaxaiCredential(credentials) {
  return fromCookie(credentials) || fromProviderSpecificData(credentials);
}
