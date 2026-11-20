/**
 * Destination trust for /v1/search — the credential-binding decision, on its own.
 *
 * Port of OmniRoute `open-sse/handlers/search/baseUrl.ts` (PR #12620, merged
 * 2026-09-03, GHSA-3f8g-pfh9-j687) with DurinDoor's own guard modes kept.
 *
 * The two `baseUrl` sources are NOT equally trusted, and reading them through
 * one call is what produced the advisory:
 *
 *   - `providerSpecificData.baseUrl` is the stored provider connection
 *     (`credentials.providerSpecificData`) — OPERATOR config. It names the
 *     endpoint the administrator authorized for this connection, so it wins
 *     over anything a caller sends.
 *   - `providerOptions.baseUrl` is `body.provider_options` — CALLER input. The
 *     dedicated builders attach the OPERATOR's stored key to whatever host the
 *     base URL resolves to (`key=`/`api_key=` in the query for
 *     google-pse/searchapi, `X-API-Key`/`Authorization` for
 *     you.com/linkup/nimble/ollama), so a caller-chosen host would collect it.
 *     The public-only guard does nothing about that, because the caller simply
 *     names their own PUBLIC host.
 *
 * DurinDoor keeps its existing egress policy instead of upstream's: both
 * sources are validated `public-only` by `assertOutboundUrlAllowed`, and a
 * caller-selected destination still travels through `fetchPublic`, which
 * re-validates every redirect hop. This module only decides WHICH destination
 * a request may use and whether a stored credential may travel with it — it
 * never relaxes the per-hop guard.
 */

import { assertOutboundUrlAllowed } from "../../utils/outboundUrlGuard.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

/** Error code for a refused caller-supplied `provider_options.baseUrl`. */
export const SEARCH_BASE_URL_OVERRIDE_REFUSED = "SEARCH_BASE_URL_OVERRIDE_REFUSED";

/**
 * Refusal for a caller-supplied `provider_options.baseUrl` that would move a
 * stored credential to a destination the administrator did not authorize.
 */
export class SearchBaseUrlOverrideError extends Error {
  constructor(providerId) {
    super(
      `provider_options.baseUrl is not accepted for search provider "${providerId}". ` +
      "Set the base URL on the provider connection instead."
    );
    this.name = "SearchBaseUrlOverrideError";
    this.code = SEARCH_BASE_URL_OVERRIDE_REFUSED;
  }
}

/** Read one string setting from a SINGLE source, so callers can tell trust apart. */
function readSetting(source, key) {
  const value = source?.[key];
  return isString(value) && value.trim().length > 0 ? value.trim() : undefined;
}

function trimTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

/** The administrator-stored destination for this provider connection. */
export function operatorSearchBaseUrl(params) {
  return readSetting(params?.providerSpecificData, "baseUrl");
}

/** The destination the caller asked for on this request. */
export function callerSearchBaseUrl(params) {
  return readSetting(params?.providerOptions, "baseUrl");
}

/**
 * Resolve the destination for a dedicated search request.
 *
 * The operator's connection endpoint wins over a caller-supplied one, so a
 * caller can never shadow the endpoint the administrator authorized. The
 * registry default (`config.baseUrl`) stays administrator-controlled and may
 * intentionally target an internal service (a SearXNG container); it is not
 * validated here, exactly as before this port.
 *
 * @param {{id?: string, baseUrl?: string}} config Provider search config.
 * @param {object} params Search request params (providerOptions/providerSpecificData/token).
 * @returns {{baseUrl: string, source: "operator"|"caller"|"registry"}}
 * @throws {import("../../utils/outboundUrlGuard.js").OutboundUrlGuardError} When a
 *   configured destination is invalid or targets a private address.
 */
export function resolveSearchBaseUrl(config, params) {
  const operatorBaseUrl = operatorSearchBaseUrl(params);
  if (operatorBaseUrl) {
    assertOutboundUrlAllowed(operatorBaseUrl, "public-only");
    return { baseUrl: trimTrailingSlash(operatorBaseUrl), source: "operator" };
  }
  const callerBaseUrl = callerSearchBaseUrl(params);
  if (callerBaseUrl) {
    assertOutboundUrlAllowed(callerBaseUrl, "public-only");
    return { baseUrl: trimTrailingSlash(callerBaseUrl), source: "caller" };
  }
  return { baseUrl: trimTrailingSlash(config?.baseUrl), source: "registry" };
}

/** Origins an administrator has authorized for this provider. */
export function authorizedSearchOrigins(config, params) {
  const origins = new Set();
  for (const candidate of [config?.baseUrl, operatorSearchBaseUrl(params)]) {
    if (!isString(candidate) || !candidate.trim()) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Not a URL: there is nothing to authorize against.
    }
  }
  return origins;
}

// Header names that carry a provider credential in the dedicated search builders.
const CREDENTIAL_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-subscription-token",
  "api-key",
  "x-goog-api-key"
]);

// Query names that carry a provider credential (google-pse `key=`, searchapi `api_key=`).
const CREDENTIAL_QUERY_NAMES = new Set([
  "key",
  "api_key",
  "apikey",
  "api-key",
  "token",
  "access_token"
]);

function headerEntries(headers) {
  if (!headers) return [];
  try {
    // Parse at the boundary: the builders hand over a plain object, but a
    // Headers instance is accepted too.
    return [...new Headers(headers).entries()];
  } catch {
    // An unreadable header set carries no credential we could inspect.
    return [];
  }
}

/**
 * Does the built request carry the stored credential to its destination?
 *
 * Checked on the built request rather than on the provider config, so the
 * answer is exact: a keyless builder that ignores the token (SearXNG) is not
 * treated as credential-bearing, while a keyless builder that accepts an
 * optional Bearer (Context7) is.
 *
 * @param {string} url Built request URL.
 * @param {object|Headers} headers Built request headers.
 * @param {string} [token] Stored credential value.
 * @returns {boolean}
 */
export function requestCarriesSearchCredential(url, headers, token) {
  if (!isString(token) || token.length === 0) return false;
  for (const [name, value] of headerEntries(headers)) {
    if (!isString(value) || !CREDENTIAL_HEADER_NAMES.has(String(name).toLowerCase())) continue;
    if (value.includes(token)) return true;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  for (const [name, value] of parsed.searchParams) {
    if (!CREDENTIAL_QUERY_NAMES.has(String(name).toLowerCase())) continue;
    if (value.includes(token)) return true;
  }
  return false;
}

/**
 * Bind a stored search credential to an administrator-authorized destination.
 *
 * Throws {@link SearchBaseUrlOverrideError} when the built request would carry
 * the stored credential to an origin the administrator did not authorize (a
 * caller-selected `provider_options.baseUrl`). A request without a credential,
 * or one aimed at an authorized origin, passes untouched.
 *
 * @param {{config: object, params: object, url: string, init: object}} input
 */
export function assertSearchCredentialBinding({ config, params, url, init }) {
  const token = params?.token;
  if (!requestCarriesSearchCredential(url, init?.headers, token)) return;
  let target = null;
  try {
    target = new URL(url).origin;
  } catch {
    target = null;
  }
  // An unparsable destination can never be requested, so there is nothing to
  // protect here — the request fails on its own before any socket is opened.
  if (!target) return;
  if (authorizedSearchOrigins(config, params).has(target)) return;
  throw new SearchBaseUrlOverrideError(config?.id);
}
