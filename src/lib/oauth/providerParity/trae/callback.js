import { isObject, isString } from "../../../../shared/utils/typeChecks.js";

// Adapted from OmniRoute (MIT), b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523:
// src/app/authorize/parseCallback.ts and open-sse/utils/traeHost.ts.
const DEFAULT_HOST = "https://api-us-east.trae.ai";
const DEFAULT_CLIENT_ID = "en1oxy7wnw8j9n";

/** A refresh credential may only be sent to a Trae HTTPS host. */
export function parseTraeApiHost(value) {
  if (!isString(value) || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !(url.hostname === "trae.ai" || url.hostname.endsWith(".trae.ai"))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function string(value, fallback = "") {
  return isString(value) && value ? value : fallback;
}

function expiry(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const date = new Date(number);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

/** Parse only after the caller has claimed the matching, owned OAuth flow. */
export function parseTraeCallback(query) {
  let jwt;
  try { jwt = JSON.parse(query.get("userJwt") || ""); } catch { throw new Error("Invalid Trae callback"); }
  if (!jwt || !isObject(jwt) || Array.isArray(jwt) || !string(jwt.Token)) {
    throw new Error("Invalid Trae callback");
  }
  const suppliedHost = query.get("host");
  const host = suppliedHost ? parseTraeApiHost(suppliedHost) : DEFAULT_HOST;
  if (!host) throw new Error("Invalid Trae callback host");
  let info = {};
  try {
    const parsed = JSON.parse(query.get("userInfo") || "{}");
    if (parsed && isObject(parsed) && !Array.isArray(parsed)) info = parsed;
  } catch { /* Optional metadata. */ }
  const userId = string(info.UserID);
  const region = string(info.Region, "US-East");
  return {
    provider: "trae", authType: "oauth", accessToken: jwt.Token,
    refreshToken: string(jwt.RefreshToken) || string(query.get("refreshToken")) || null,
    expiresAt: expiry(jwt.TokenExpireAt), email: string(info.NonPlainTextEmail) || null,
    providerSpecificData: {
      userId, tenantId: string(info.TenantID), bizUserId: userId, userUniqueId: userId, webId: userId,
      scope: "marscode-us", tenant: "marscode", region, aiRegion: string(info.AIRegion, region), host,
      screenName: string(info.ScreenName) || null, clientId: string(jwt.ClientID, DEFAULT_CLIENT_ID),
      refreshExpireAt: Number(jwt.RefreshExpireAt || query.get("refreshExpireAt")) || null,
      authMethod: "oauth_callback",
      ...(string(info.UserRegion) ? { userRegion: info.UserRegion } : null),
      ...(string(info.Timezone) ? { userTimezone: info.Timezone } : null)
    }, testStatus: "active"
  };
}

/** Refresh callback credentials only; imported sessions do not have this contract. */
export async function refreshTraeCallbackCredentials(credentials, { fetchImpl = fetch, signal } = {}) {
  const data = credentials?.providerSpecificData || {};
  if (data.authMethod !== "oauth_callback" || !string(credentials?.refreshToken)) return null;
  if (Number(data.refreshExpireAt) > 0 && Number(data.refreshExpireAt) <= Date.now()) {
    throw new Error("Trae refresh credential expired");
  }
  const host = parseTraeApiHost(data.host);
  if (!host) throw new Error("Invalid Trae refresh host");
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  let response;
  try {
    response = await fetchImpl(`${host}/cloudide/api/v3/trae/oauth/ExchangeToken`, {
      method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error", signal,
      body: JSON.stringify({ ClientID: string(data.clientId, DEFAULT_CLIENT_ID), RefreshToken: credentials.refreshToken, ClientSecret: "-", UserID: "" })
    });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    if (payload?.ResponseMetadata?.Error || !string(payload?.Result?.Token)) throw new Error();
    return { accessToken: payload.Result.Token, refreshToken: string(payload.Result.RefreshToken, credentials.refreshToken), expiresAt: expiry(payload.Result.TokenExpireAt) };
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    throw new Error("Trae token refresh failed");
  }
}

/** The generic OAuth entry points do not implement Trae's callback protocol. */
export function requireTraeImportMode(action) {
  if (action !== "import-token") throw new Error("Trae requires session import");
}
