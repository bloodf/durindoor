// The stored credential is the Clerk `__client` cookie, itself a JWT. Parsing
// follows OmniRoute open-sse/executors/venice-web-auth.ts, but anything that is
// not exactly one JWT-shaped `__client` value is refused before a send.
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import { expiredSession, invalidCredential } from "./errors.js";

const MAX_JWT_LENGTH = 8192;
// The base64url alphabet excludes every character that could break a header.
const COMPACT_JWT = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** The claims of a JWT-shaped value, or null. The signature is never verified. */
export function decodeVeniceJwt(value) {
  if (!isString(value) || value.length > MAX_JWT_LENGTH || !COMPACT_JWT.test(value)) return null;
  try {
    const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    return isRecord(claims) ? claims : null;
  } catch {
    return null;
  }
}

/** The `exp` claim in milliseconds, or 0 when the token carries none. */
export const jwtExpiryMs = (claims) => Number.isFinite(claims?.exp) && claims.exp > 0 ? claims.exp * 1000 : 0;

/** The `__client` value of a bare token, a `__client=` pair or a Cookie header; "" when unclear. */
export function extractVeniceClientCookie(raw) {
  if (!isString(raw)) return "";
  const text = raw.trim().replace(/^cookie:\s*/i, "");
  if (!text || /[\r\n\0]/.test(text)) return "";
  if (!text.includes("=")) return text;
  const values = text.split(";").map((pair) => pair.trim())
    .filter((pair) => pair.startsWith("__client="))
    .map((pair) => pair.slice("__client=".length));
  return values.length === 1 ? values[0] : "";
}

/**
 * Read the cookie of one connection. Only `apiKey`, where cookie import stores
 * it, is read. Throws VeniceWebError without sending anything.
 */
export function readVeniceWebCredential(credentials, now = Date.now()) {
  const clientJwt = extractVeniceClientCookie(credentials?.apiKey);
  const claims = decodeVeniceJwt(clientJwt);
  if (!claims) {
    throw invalidCredential("Venice Web needs the __client cookie of clerk.venice.ai (a JWT). A Venice API key does not work here.");
  }
  const expiresAt = jwtExpiryMs(claims);
  if (expiresAt && expiresAt <= now) throw expiredSession();
  return { clientJwt };
}
