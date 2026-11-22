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
/** Most localStorage items an import may carry. */
export const MAX_IMPORT_LOCAL_STORAGE_ITEMS = 4;

/**
 * Select an explicit import profile or reuse the provider's web sign-in rules.
 * A provider of any category may declare a `cookieImport` profile that names
 * `localStorageKeys`: its credential is a browser localStorage value (TinyCMS
 * `app-config-uuid`), not a cookie.
 */
export function cookieImportConfig(provider) {
  if (Array.isArray(provider?.cookieImport?.localStorageKeys) && provider.cookieImport.localStorageKeys.length > 0) return provider.cookieImport;
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
 * @returns {{ origin: string, host: string, extensionCapture: boolean, cookieNames: readonly string[], cookiePrefixes: readonly string[] } | null}
 */
export function resolveCookieImportContract(config) {
  if (!config || !Array.isArray(config.cookieNames) || !config.cookieNames.every(isValidCookieName)) return null;
  const localStorageKeys = config.localStorageKeys === undefined ? [] : config.localStorageKeys;
  if (!Array.isArray(localStorageKeys) || localStorageKeys.length > MAX_IMPORT_LOCAL_STORAGE_ITEMS || !localStorageKeys.every(isValidLocalStorageKey)) return null;
  // A contract names at least one credential: a cookie or a localStorage item.
  if (config.cookieNames.length === 0 && localStorageKeys.length === 0) return null;
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
    ...(localStorageKeys.length ? { localStorageKeys: Object.freeze([...localStorageKeys]) } : null),
    ...(credentialPattern ? { credentialPattern } : null),
  });
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
  if (contract.cookieNames.includes(name)) return true;
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
