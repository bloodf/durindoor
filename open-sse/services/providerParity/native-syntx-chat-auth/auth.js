// SYNTX Bearer JWT resolution. Port of OmniRoute c71f0065
// open-sse/services/syntxAuth.ts. The credential is a long-lived site JWT the
// user pastes raw, as `Bearer <jwt>`, or inside a JSON wrapper. The source has
// no refresh call; a rejected token is a re-paste.
//
// Fork deviation: connectionFingerprint keys session state by a SHA-256 of
// the connection id and the token together (the source used the id alone, or
// a token head/tail slice), so a re-pasted token for another account never
// inherits the previous account's chat_uuid, and no token fragment is held.
import { createHash } from "node:crypto";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { SYNTX_ORIGIN, SYNTX_SITE, SYNTX_USER_AGENT } from "./config.js";

export function stripBearerPrefix(raw) {
  const text = (isString(raw) ? raw : "").trim();
  if (text.length >= 7 && text.slice(0, 7).toLowerCase() === "bearer ") return text.slice(7).trim();
  return text;
}

/** Source looksLikeJwt: `eyJ` prefix and three dot-separated parts. */
export function looksLikeJwt(token) {
  const raw = stripBearerPrefix(token);
  if (!raw || !raw.startsWith("eyJ")) return false;
  return raw.split(".").length === 3;
}

const TOKEN_KEYS = ["accessToken", "access_token", "token", "jwt", "idToken", "id_token", "apiKey"];

function firstString(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (isString(value) && value.trim()) return stripBearerPrefix(value);
  }
  return "";
}

/** Source extractSyntxTokenFromUnknown, with a nesting bound. */
export function extractSyntxTokenFromUnknown(value, depth = 0) {
  if (depth > 4) return "";
  if (isString(value)) {
    const trimmed = stripBearerPrefix(value);
    if (!trimmed) return "";
    if (trimmed.startsWith("{")) {
      try {
        return extractSyntxTokenFromUnknown(JSON.parse(trimmed), depth + 1);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (!isRecord(value)) return "";
  return firstString(value, TOKEN_KEYS) || extractSyntxTokenFromUnknown(value.authorization, depth + 1);
}

/**
 * Source resolveSyntxToken: accessToken, then apiKey, then providerSpecificData;
 * the first JWT-shaped candidate wins, else the first non-empty one.
 */
export function resolveSyntxToken({ apiKey, accessToken, providerSpecificData } = {}) {
  const candidates = [
    extractSyntxTokenFromUnknown(accessToken),
    extractSyntxTokenFromUnknown(apiKey),
    extractSyntxTokenFromUnknown(providerSpecificData),
  ].filter((value) => value.length > 0);
  return candidates.find((value) => looksLikeJwt(value)) || candidates[0] || "";
}

/** Source syntxAuthHeaders: the browser header set every api.syntx.ai call carries. */
export function syntxAuthHeaders(token) {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en",
    authorization: `Bearer ${token}`,
    origin: SYNTX_ORIGIN,
    referer: SYNTX_SITE,
    "user-agent": SYNTX_USER_AGENT,
  };
}

/** Account-scoped session key (see the fork deviation above). */
export function connectionFingerprint(token, connectionId) {
  const id = isString(connectionId) ? connectionId.trim() : "";
  return createHash("sha256").update(`syntx\0${id}\0${stripBearerPrefix(token)}`).digest("hex").slice(0, 40);
}

/** Every secret form a credential can take, for error and log redaction. */
export function syntxSecrets(credentials, token) {
  const out = new Set();
  const add = (value) => {
    if (isString(value) && value.trim().length >= 8) {
      out.add(value.trim());
      out.add(stripBearerPrefix(value));
    }
  };
  add(token);
  add(credentials?.apiKey);
  add(credentials?.accessToken);
  if (isRecord(credentials?.providerSpecificData)) for (const key of TOKEN_KEYS) add(credentials.providerSpecificData[key]);
  return [...out].filter(Boolean);
}
