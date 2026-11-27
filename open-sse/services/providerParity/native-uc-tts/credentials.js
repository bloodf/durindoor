// UC connection credential resolution for the staged TTS adapter. Port of
// OmniRoute c71f0065 open-sse/executors/uc/credentials.ts (resolveUcCredential,
// normalizeCookieJar, cookieHeader, JWT uid claim), with header-safety checks:
// a value that could split a header, a URL path or a cookie pair is refused,
// never sent.
import { Buffer } from "node:buffer";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { UC_PROVIDER_DEFINITION } from "./config.js";

const TOKEN_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/; // RFC 6265 cookie-octet, plus nothing else
const SID = /^[A-Za-z0-9_]{1,128}$/;
const UID = /^[A-Za-z0-9-]{1,128}$/;
const MAX_COOKIE_BYTES = 16 * 1024;

const fields = UC_PROVIDER_DEFINITION.credentialFields;

function firstString(record, names) {
  for (const name of names) {
    const value = record?.[name];
    if (isString(value)) {
      // Raw browser dumps sometimes wrap the value in quotes (source behavior).
      const trimmed = value.trim().replace(/^"|"$/g, "");
      if (trimmed) return trimmed;
    }
  }
  return null;
}

/** Flat `{ name: value }` jar from `{ name: "v" }` or a CDP `{ name: { value } }` dump; unsafe entries dropped. */
export function normalizeCookieJar(raw) {
  const out = {};
  if (!isRecord(raw)) return out;
  for (const [name, entry] of Object.entries(raw)) {
    const value = isString(entry) ? entry : isRecord(entry) && isString(entry.value) ? entry.value : null;
    if (value !== null && TOKEN_NAME.test(name) && COOKIE_VALUE.test(value)) out[name] = value;
  }
  return out;
}

export const cookieHeader = (cookies) => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");

/**
 * The selected connection's UC credential from providerSpecificData, or null
 * when incomplete or unsafe. Source precedence: ucClientCookie / clientCookie /
 * __client, ucSid / sid, ucUid / uid, ucCookies / cookies. `apiKey` and OAuth
 * tokens are never read.
 */
export function resolveUcCredential(credentials) {
  const psd = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : null;
  if (!psd) return null;
  const clientCookie = firstString(psd, fields.clientCookie);
  const sid = firstString(psd, fields.sid);
  const uid = firstString(psd, fields.uid);
  if (!clientCookie || !sid || !uid) return null;
  if (!COOKIE_VALUE.test(clientCookie) || !SID.test(sid) || !UID.test(uid)) return null;
  const cookies = normalizeCookieJar(psd[fields.cookies[0]] ?? psd[fields.cookies[1]]);
  if (!cookies.__client) cookies.__client = clientCookie;
  if (Buffer.byteLength(cookieHeader(cookies)) > MAX_COOKIE_BYTES) return null;
  return { clientCookie, sid, uid, cookies };
}

/** Every opaque value of the selected connection, for error redaction. */
export function ucSecrets(credentials, credential = null, jwt = null) {
  const psd = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : {};
  const values = [credentials?.apiKey, credentials?.accessToken, jwt, credential?.clientCookie, ...Object.values(credential?.cookies ?? {})];
  for (const names of Object.values(fields)) for (const name of names) if (isString(psd[name])) values.push(psd[name]);
  return { apiKey: values.filter((v) => isString(v) && v.length >= 8) };
}

/** The `uid` claim of a Clerk session JWT (unverified decode), or null. */
export function uidFromSessionJwt(jwt) {
  try {
    const segment = jwt.split(".")[1];
    const claims = JSON.parse(Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return isRecord(claims) && isString(claims.uid) && claims.uid ? claims.uid : null;
  } catch {
    return null;
  }
}
