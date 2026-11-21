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

import { isString } from "./typeChecks.js";

/** Same caps the import API enforces on the stored cookie set. */
export const MAX_IMPORT_COOKIES = 16;
export const MAX_COOKIE_VALUE_LENGTH = 8192;

const TOKEN_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/;
// Control characters, `;` (cookie-pair separator) and edge whitespace could splice extra cookies into the stored Cookie header.
const UNSAFE_VALUE_RE = /[\u0000-\u001f\u007f;]|^\s|\s$/;

/** Select an explicit import profile or reuse the provider's web sign-in rules. */
export function cookieImportConfig(provider) {
  if (provider?.category !== "webCookie" || provider.authType !== "cookie") return null;
  return provider.cookieImport ?? provider.webLogin;
}

/**
 * Importable contract for a registry profile, or null when the block
 * names no approved cookie or has no exact HTTPS origin.
 *
 * @param {object|null|undefined} config registry `cookieImport` or `webLogin` block
 * @returns {{ origin: string, host: string, extensionCapture: boolean, cookieNames: readonly string[], cookiePrefixes: readonly string[] } | null}
 */
export function resolveCookieImportContract(config) {
  if (!config || !Array.isArray(config.cookieNames) || config.cookieNames.length === 0 || !config.cookieNames.every(isValidCookieName)) return null;
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
  });
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

/** Cookie values may not carry control characters, `;` or edge whitespace. */
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
