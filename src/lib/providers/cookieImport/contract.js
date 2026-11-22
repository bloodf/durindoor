/**
 * Provider cookie-import contract: the one place that says which providers a
 * browser extension may import a session into, from which origin, and under
 * which cookie names. Supported contract is documented in ./README.md.
 *
 * Registry import profiles can override web sign-in metadata for import only.
 * Both paths require an exact HTTPS origin and an explicit cookie allowlist.
 *
 * The rules themselves live in @/shared/utils/cookieImportContract.js, which the
 * dashboard import UI reads too, so the client and the server agree on which
 * origins and cookie names a provider approves.
 */

import REGISTRY from "open-sse/providers/registry/index.js";
import { hasRequiredCookies, composeCookieHeader } from "@/lib/webLoginSession";
import { isString, isNumber, isRecord } from "@/shared/utils/typeChecks";
import {
  MAX_IMPORT_COOKIES,
  MAX_COOKIE_VALUE_LENGTH,
  cookieImportConfig,
  resolveCookieImportContract,
  isApprovedCookieName,
  isValidCookieName,
  isValidCookieValue,
  cookieDomainAllowed,
  validateImportedLocalStorage,
} from "@/shared/utils/cookieImportContract";

export const MAX_COOKIES = MAX_IMPORT_COOKIES;
export { MAX_COOKIE_VALUE_LENGTH, validateImportedLocalStorage };

/**
 * Importable contract for a provider id, or null when the provider does not
 * support cookie import.
 * @param {string} providerId
 * `authType` is the auth type of the connection an import creates or replaces:
 * "cookie" for a web-cookie provider, the registry auth type for a provider
 * whose only credential is a localStorage value.
 * @returns {{ provider: string, authType: string, origin: string, host: string, extensionCapture: boolean, cookieNames: readonly string[], cookiePrefixes: readonly string[], localStorageKeys?: readonly string[], credentialPattern?: string, config: object } | null}
 */
export function getCookieImportContract(providerId) {
  const entry = REGISTRY.find((candidate) => candidate.id === providerId);
  const config = cookieImportConfig(entry);
  const resolved = resolveCookieImportContract(config);
  if (!resolved) return null;
  return Object.freeze({
    provider: String(providerId),
    authType: entry.category === "webCookie" ? "cookie" : (entry.authType || "apikey"),
    ...resolved,
    config,
  });
}

/**
 * What a client needs to know to collect cookies, with no internal config. This is the required
 * allowlist; `optionalCookies` are added next to it by the pairing response.
 */
export function describeCookieImportContract(contract) {
  const description = {
    origin: contract.origin,
    cookieNames: [...contract.cookieNames],
    cookiePrefixes: [...contract.cookiePrefixes],
  };
  if (contract.localStorageKeys?.length) description.localStorageKeys = [...contract.localStorageKeys];
  if (!contract.extensionCapture) description.extensionCapture = false;
  return description;
}

/**
 * Validate a browser cookie list against the contract and compose the Cookie
 * header to store. Error strings are static: they never contain submitted
 * names or values.
 * @returns {{ ok: true, header: string } | { ok: false, error: string }}
 */
export function buildImportedCookieHeader(contract, cookies, now = Date.now()) {
  // A localStorage-only contract (no cookie names) carries no cookie at all.
  if (contract.cookieNames.length === 0) {
    return cookies === undefined || (Array.isArray(cookies) && cookies.length === 0)
      ? { ok: true, header: "" }
      : { ok: false, error: "Cookie name is not approved for this provider" };
  }
  if (!Array.isArray(cookies) || cookies.length === 0) return { ok: false, error: "cookies must be a non-empty array" };
  if (cookies.length > MAX_COOKIES) return { ok: false, error: "Too many cookies" };
  const jar = new Map();
  for (const cookie of cookies) {
    if (!isRecord(cookie) || !isString(cookie.name) || !isString(cookie.value)) return { ok: false, error: "Each cookie needs a name and value" };
    if (!isValidCookieName(cookie.name) || !isApprovedCookieName(contract, cookie.name)) return { ok: false, error: "Cookie name is not approved for this provider" };
    if (!isValidCookieValue(cookie.value)) return { ok: false, error: "Cookie value is not acceptable" };
    if (cookie.domain !== undefined && (!isString(cookie.domain) || !cookieDomainAllowed(contract.host, cookie.domain))) return { ok: false, error: "Cookie domain does not match the provider origin" };
    if (cookie.secure === false) return { ok: false, error: "Cookie must be a secure cookie" };
    if (cookie.expirationDate !== undefined && (!isNumber(cookie.expirationDate) || cookie.expirationDate * 1000 <= now)) return { ok: false, error: "Cookie is expired" };
    if (jar.has(cookie.name)) return { ok: false, error: "Duplicate cookie name" };
    jar.set(cookie.name, { name: cookie.name, value: cookie.value, domain: contract.host, path: "/", hostOnly: true });
  }
  // Same required-cookie and chunk-continuity rules, and the same header
  // composition, as the dashboard sign-in capture.
  const session = { config: contract.config, origin: contract.origin, jar: new Map([...jar.values()].map((c) => [`${c.name}|${c.domain}|${c.path}`, c])) };
  if (!hasRequiredCookies(session)) return { ok: false, error: "Required session cookie is missing or incomplete" };
  return { ok: true, header: composeCookieHeader(session) };
}
