/**
 * Provider cookie-import rules shared by the dashboard import UI and the server
 * side import API (src/lib/providers/cookieImport/contract.js).
 *
 * The dashboard parses a pasted header, a pasted cURL command or a local HAR
 * file in the browser and must know, before it sends anything, which origins and
 * cookie names the provider approves. The server decides the same thing again
 * when it stores the credentials. Both sides resolve the same provider metadata.
 *
 * This module is client safe: no node built-ins, no server-only imports.
 */

import { isRecord, isString } from "./typeChecks.js";

/** Same caps the import API enforces on the stored cookie set. */
export const MAX_IMPORT_COOKIES = 16;
export const MAX_COOKIE_VALUE_LENGTH = 8192;

const TOKEN_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/;
// Only printable ASCII can be sent reliably as a Fetch header; semicolons
// separate cookie pairs, and edge whitespace is normalized by Headers.
const UNSAFE_VALUE_RE = /[^\x20-\x7e]|;|^\s|\s$/;

const LOCAL_STORAGE_KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
// An account email a profile may bind to the stored credential (Inner.ai Web). The grammar is the
// one the executor accepts after the token (open-sse/executors/inner-ai-web/credential.js), so a
// stored value always parses; it is printable ASCII without spaces, quotes, `;`, `,` or `<>`.
const ACCOUNT_EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
/** Longest account email accepted (RFC 5321 path limit). */
export const MAX_ACCOUNT_EMAIL_LENGTH = 254;
/** Most localStorage items an import may carry. */
export const MAX_IMPORT_LOCAL_STORAGE_ITEMS = 4;

/**
 * Select an explicit import profile or reuse the provider's web sign-in rules.
 * A provider of any category may declare a `cookieImport` profile that names
 * `localStorageKeys`: its credential is a browser localStorage value (TinyCMS
 * `app-config-uuid`), not a cookie. A no-auth provider may declare a
 * `cookieImport` profile with `optionalSession: true` for an optional session.
 */
export function cookieImportConfig(provider) {
  if (Array.isArray(provider?.cookieImport?.localStorageKeys) && provider.cookieImport.localStorageKeys.length > 0) return provider.cookieImport;
  // An anonymous provider may accept an optional saved web session (Veo AI
  // Free). Its profile is explicit; the provider never gains a web sign-in.
  if (provider?.noAuth === true && provider.cookieImport?.optionalSession === true) return provider.cookieImport;
  if (provider?.category !== "webCookie" || provider.authType !== "cookie") return null;
  return provider.cookieImport ?? provider.webLogin;
}

/** localStorage key names follow a narrow ASCII grammar. */
export function isValidLocalStorageKey(name) {
  return isString(name) && LOCAL_STORAGE_KEY_RE.test(name);
}

/**
 * Importable contract for a registry profile, or null when the block
 * names no approved cookie or has no exact HTTPS origin.
 *
 * @param {object|null|undefined} config registry `cookieImport` or `webLogin` block
 * `optionalCookies` names cookies that are kept when a capture or import carries them and never
 * required: a capture without them still succeeds.
 * `accountEmail: "optional"` lets the operator bind an account email to the pairing; it is appended
 * to the stored Cookie header as ` <email>`. Any other value is refused.
 *
 * @returns {{ origin: string, host: string, extensionCapture: boolean, cookieNames: readonly string[], cookiePrefixes: readonly string[], optionalCookies?: readonly string[], accountEmail?: "optional" } | null}
 */
export function resolveCookieImportContract(config) {
  if (!config || !Array.isArray(config.cookieNames) || !config.cookieNames.every(isValidCookieName)) return null;
  const localStorageKeys = config.localStorageKeys === undefined ? [] : config.localStorageKeys;
  if (!Array.isArray(localStorageKeys) || localStorageKeys.length > MAX_IMPORT_LOCAL_STORAGE_ITEMS || !localStorageKeys.every(isValidLocalStorageKey)) return null;
  // A contract names at least one credential: a cookie or a localStorage item.
  if (config.cookieNames.length === 0 && localStorageKeys.length === 0) return null;
  const optionalCookies = config.optionalCookies === undefined ? [] : config.optionalCookies;
  // Optional names follow the cookie-name grammar and never repeat a required name.
  if (!Array.isArray(optionalCookies) || optionalCookies.length > MAX_IMPORT_COOKIES || !optionalCookies.every(isValidCookieName) ||
    new Set(optionalCookies).size !== optionalCookies.length || optionalCookies.some((name) => config.cookieNames.includes(name))) return null;
  // An account email rides next to one required cookie only, never a localStorage-only profile.
  if (config.accountEmail !== undefined && (config.accountEmail !== "optional" || config.cookieNames.length !== 1 || localStorageKeys.length)) return null;
  let credentialPattern = null;
  if (config.credentialPattern !== undefined) {
    if (!isString(config.credentialPattern)) return null;
    try { new RegExp(config.credentialPattern); } catch { return null; }
    credentialPattern = config.credentialPattern;
  }
  let origin;
  try {
    origin = new URL(config.origin);
  } catch {
    return null;
  }
  if (origin.protocol !== "https:" || origin.origin !== config.origin.replace(/\/+$/, "")) return null;
  return Object.freeze({
    origin: origin.origin,
    host: origin.hostname.toLowerCase(),
    extensionCapture: config.extensionCapture !== false,
    cookieNames: Object.freeze([...config.cookieNames]),
    cookiePrefixes: Object.freeze(Array.isArray(config.cookiePrefixes) ? [...config.cookiePrefixes] : []),
    ...(optionalCookies.length ? { optionalCookies: Object.freeze([...optionalCookies]) } : null),
    ...(localStorageKeys.length ? { localStorageKeys: Object.freeze([...localStorageKeys]) } : null),
    ...(credentialPattern ? { credentialPattern } : null),
    ...(config.accountEmail === "optional" ? { accountEmail: "optional" } : null),
  });
}

/**
 * Normalize an operator-supplied account email. Blank or absent means "no email"; any non-string
 * (including null) is refused. Error strings are static and never echo the input.
 * @returns {{ ok: true, email: string } | { ok: false, error: string }}
 */
export function normalizeAccountEmail(value) {
  if (value === undefined) return { ok: true, email: "" };
  if (!isString(value)) return { ok: false, error: "Account email is not valid" };
  const email = value.trim();
  if (!email) return { ok: true, email: "" };
  if (email.length > MAX_ACCOUNT_EMAIL_LENGTH || !ACCOUNT_EMAIL_RE.test(email)) return { ok: false, error: "Account email is not valid" };
  return { ok: true, email };
}

/**
 * Validate the named localStorage values an import carries. Every key the
 * contract names is required, no other key is accepted, and a value must be
 * printable ASCII (and match `credentialPattern` when the contract sets one).
 * Error strings are static: they never contain submitted names or values.
 *
 * @returns {{ ok: true, values: Record<string, string> } | { ok: false, error: string }}
 */
export function validateImportedLocalStorage(contract, values) {
  const keys = contract?.localStorageKeys ?? [];
  if (!keys.length) {
    return values === undefined || (isRecord(values) && Object.keys(values).length === 0)
      ? { ok: true, values: {} }
      : { ok: false, error: "This provider takes no localStorage value" };
  }
  if (!isRecord(values)) return { ok: false, error: "localStorage values are required" };
  const submitted = Object.keys(values);
  if (submitted.length !== keys.length || submitted.some((key) => !keys.includes(key))) return { ok: false, error: "localStorage key is not approved for this provider" };
  const pattern = contract.credentialPattern ? new RegExp(contract.credentialPattern) : null;
  const out = {};
  for (const key of keys) {
    const value = isString(values[key]) ? values[key].trim() : "";
    if (!isValidCookieValue(value)) return { ok: false, error: "localStorage value is not acceptable" };
    if (pattern && !pattern.test(value)) return { ok: false, error: "localStorage value does not match the provider's credential format" };
    out[key] = value;
  }
  return { ok: true, values: out };
}

/**
 * Chunk index when `name` is `<prefix><N>` for a prefix that belongs to `base`.
 * @returns {number|null}
 */
export function cookieChunkIndex(contract, base, name) {
  for (const prefix of contract.cookiePrefixes) {
    if (!prefix.startsWith(base) || !name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    if (/^\d+$/.test(rest)) return Number(rest);
  }
  return null;
}

/**
 * True when the provider approves this cookie name: either the name itself or
 * a chunk of an approved cookie.
 */
export function isApprovedCookieName(contract, name) {
  if (contract.cookieNames.includes(name) || contract.optionalCookies?.includes(name)) return true;
  return contract.cookiePrefixes.some((prefix) =>
    name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)) &&
    contract.cookieNames.some((base) => prefix.startsWith(base)));
}

/** Cookie names follow the RFC token grammar. */
export function isValidCookieName(name) {
  return isString(name) && TOKEN_NAME_RE.test(name);
}

/** Cookie values must be printable ASCII without `;` or edge whitespace. */
export function isValidCookieValue(value) {
  return isString(value) && value.length > 0 &&
    value.length <= MAX_COOKIE_VALUE_LENGTH && !UNSAFE_VALUE_RE.test(value);
}

/**
 * A cookie domain must be the provider host or a parent of it, never a bare
 * public suffix.
 */
export function cookieDomainAllowed(host, domain) {
  if (!isString(domain)) return false;
  const d = domain.replace(/^\./, "").toLowerCase();
  return d.includes(".") && (host === d || host.endsWith(`.${d}`));
}
