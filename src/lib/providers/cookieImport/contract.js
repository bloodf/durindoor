/**
 * Provider cookie-import contract: the one place that says which providers a
 * browser extension may import a session into, from which origin, and under
 * which cookie names. Supported contract is documented in ./README.md.
 *
 * The metadata is derived from the registry `webLogin` block, the same source
 * the dashboard sign-in capture uses, so the two paths cannot drift. A provider
 * without an explicit cookie-name allowlist (`cookieNames: "*"`) or without an
 * HTTPS origin is not importable.
 */

import { getWebLoginConfig, hasRequiredCookies, composeCookieHeader } from "@/lib/webLoginSession";
import { isString, isNumber, isRecord } from "@/shared/utils/typeChecks";

export const MAX_COOKIES = 16;
export const MAX_COOKIE_VALUE_LENGTH = 8192;
const TOKEN_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/;
// Control characters, `;` (cookie-pair separator) and edge whitespace could splice extra cookies into the stored Cookie header.
const UNSAFE_VALUE_RE = /[\u0000-\u001f\u007f;]|^\s|\s$/;

/**
 * Importable contract for a provider id, or null when the provider does not
 * support cookie import.
 * @param {string} providerId
 * @returns {{ provider: string, origin: string, host: string, cookieNames: readonly string[], cookiePrefixes: readonly string[], config: object } | null}
 */
export function getCookieImportContract(providerId) {
  const config = getWebLoginConfig(providerId);
  if (!config || !Array.isArray(config.cookieNames) || config.cookieNames.length === 0) return null;
  let origin;
  try {
    origin = new URL(config.origin);
  } catch {
    return null;
  }
  if (origin.protocol !== "https:" || origin.origin !== config.origin.replace(/\/+$/, "")) return null;
  return Object.freeze({
    provider: String(providerId),
    origin: origin.origin,
    host: origin.hostname.toLowerCase(),
    cookieNames: Object.freeze([...config.cookieNames]),
    cookiePrefixes: Object.freeze(Array.isArray(config.cookiePrefixes) ? [...config.cookiePrefixes] : []),
    config,
  });
}

/** What a client needs to know to collect cookies, with no internal config. */
export function describeCookieImportContract(contract) {
  return { origin: contract.origin, cookieNames: [...contract.cookieNames], cookiePrefixes: [...contract.cookiePrefixes] };
}

function isApprovedName(contract, name) {
  if (contract.cookieNames.includes(name)) return true;
  return contract.cookiePrefixes.some((prefix) =>
    name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)) &&
    contract.cookieNames.some((base) => prefix.startsWith(base)));
}

function domainAllowed(host, domain) {
  const d = domain.replace(/^\./, "").toLowerCase();
  return d.includes(".") && (host === d || host.endsWith(`.${d}`));
}

/**
 * Validate a browser cookie list against the contract and compose the Cookie
 * header to store. Error strings are static: they never contain submitted
 * names or values.
 * @returns {{ ok: true, header: string } | { ok: false, error: string }}
 */
export function buildImportedCookieHeader(contract, cookies, now = Date.now()) {
  if (!Array.isArray(cookies) || cookies.length === 0) return { ok: false, error: "cookies must be a non-empty array" };
  if (cookies.length > MAX_COOKIES) return { ok: false, error: "Too many cookies" };
  const jar = new Map();
  for (const cookie of cookies) {
    if (!isRecord(cookie) || !isString(cookie.name) || !isString(cookie.value)) return { ok: false, error: "Each cookie needs a name and value" };
    if (!TOKEN_NAME_RE.test(cookie.name) || !isApprovedName(contract, cookie.name)) return { ok: false, error: "Cookie name is not approved for this provider" };
    if (cookie.value.length === 0 || cookie.value.length > MAX_COOKIE_VALUE_LENGTH || UNSAFE_VALUE_RE.test(cookie.value)) return { ok: false, error: "Cookie value is not acceptable" };
    if (cookie.domain !== undefined && (!isString(cookie.domain) || !domainAllowed(contract.host, cookie.domain))) return { ok: false, error: "Cookie domain does not match the provider origin" };
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
