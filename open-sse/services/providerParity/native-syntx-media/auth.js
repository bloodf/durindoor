// SYNTX.ai credential: a long-lived site JWT sent as `Authorization: Bearer`.
// Ported from OmniRoute c71f0065 open-sse/services/syntxAuth.ts (see
// ./config.js). Only the selected connection's own fields are read, in the
// source order accessToken, apiKey, providerSpecificData, preferring a
// JWT-shaped value. The source handlers refuse a non-JWT with 401 before any
// request; so does this module.
import { SYNTX_SITE, SYNTX_SITE_ORIGIN, SYNTX_USER_AGENT } from "./config.js";
import { isObject, isString } from "../../../../src/shared/utils/typeChecks.js";

const TOKEN_KEYS = ["accessToken", "access_token", "token", "jwt", "idToken", "id_token", "apiKey"];
const MAX_TOKEN_CHARS = 16 * 1024;
const MAX_DEPTH = 3;
const JWT_TOKEN_PATTERN = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export function stripBearerPrefix(raw) {
  const text = isString(raw) ? raw.trim() : "";
  return text.length >= 7 && text.slice(0, 7).toLowerCase() === "bearer " ? text.slice(7).trim() : text;
}

/**
 * Source looksLikeJwt (`eyJ` prefix and three dot parts), tightened to the
 * base64url alphabet so the value is always a safe header (no CR/LF, spaces).
 */
export function looksLikeJwt(token) {
  const raw = stripBearerPrefix(token);
  return raw.length > 0 && raw.length <= MAX_TOKEN_CHARS && JWT_TOKEN_PATTERN.test(raw);
}

/** Source extractSyntxTokenFromUnknown: a raw token, `Bearer <jwt>`, or a JSON wrapper. */
export function extractSyntxToken(value, depth = 0) {
  if (depth > MAX_DEPTH) return "";
  if (isString(value)) {
    const trimmed = stripBearerPrefix(value);
    if (!trimmed || trimmed.length > MAX_TOKEN_CHARS * 4) return "";
    if (trimmed.startsWith("{")) {
      try {
        return extractSyntxToken(JSON.parse(trimmed), depth + 1);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (!value || !isObject(value) || Array.isArray(value)) return "";
  for (const key of TOKEN_KEYS) {
    const field = value[key];
    if (isString(field) && field.trim()) return stripBearerPrefix(field);
  }
  return extractSyntxToken(value.authorization, depth + 1);
}

/**
 * The selected connection's JWT, or null. Never reads another account, a
 * process environment variable, or a shared cache.
 */
export function resolveSyntxCredential(credentials) {
  const candidates = [credentials?.accessToken, credentials?.apiKey, credentials?.providerSpecificData]
    .map((value) => extractSyntxToken(value))
    .filter((value) => value.length > 0);
  const token = candidates.find((value) => looksLikeJwt(value)) ?? null;
  return token;
}

/** Source syntxAuthHeaders: browser-shaped headers for api.syntx.ai only. */
export function syntxApiHeaders(token) {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en",
    authorization: `Bearer ${token}`,
    origin: SYNTX_SITE_ORIGIN,
    referer: SYNTX_SITE,
    "user-agent": SYNTX_USER_AGENT,
  };
}

/** Values to redact from any message: the raw connection fields and the resolved token. */
export function syntxSecretSource(credentials, token) {
  return { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken, token: token ?? undefined };
}
