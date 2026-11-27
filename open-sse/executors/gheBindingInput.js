/**
 * Inputs handed to the GitHub Enterprise Copilot connection binding (#2034).
 *
 * Proxy route identity. Sign-in stores the OAuth proxy selection that carried the device grant in
 * `providerSpecificData.gheBinding.proxyOptions`. Later callers (request
 * dispatch, discovery, validation and refresh) resolve the same saved pool
 * into differently shaped option objects, so a structural comparison of the
 * two objects refuses every proxied connection. This module compares only the
 * fields that decide where a request leaves this process. When they match, the
 * signed-in options are used, so the request still travels the sign-in route.
 * When they differ, the caller's options are returned unchanged and the
 * connection binding refuses them with `reauthentication_needed`.
 *
 * Session expiry. The shared refresh writer stores `copilotTokenExpiresAt`
 * as ISO text, while sign-in and the binding use epoch seconds.
 *
 * Web-safe: no network, filesystem or CLI imports.
 */
import { isDeepStrictEqual } from "node:util";
import { isNumber, isRecord, isString } from "../../src/shared/utils/typeChecks.js";

/** A trimmed string option, or "" when absent. */
const text = (value) => isString(value) ? value.trim() : "";

/** The fields that choose the egress route; pool bookkeeping is ignored. */
export function gheProxyRoute(proxyOptions) {
  const options = isRecord(proxyOptions) ? proxyOptions : {};
  const proxied = options.connectionProxyEnabled === true && text(options.connectionProxyUrl) !== "";
  return {
    proxyUrl: proxied ? text(options.connectionProxyUrl) : "",
    noProxy: proxied ? text(options.connectionNoProxy) : "",
    relayUrl: text(options.vercelRelayUrl),
    disableEnvProxy: options.disableEnvProxy === true,
    strictProxy: options.strictProxy === true
  };
}

/**
 * Proxy options to hand to the GHE connection binding.
 * @param {object} credentials Stored connection or request credentials.
 * @param {object|null} proxyOptions Options resolved by the caller.
 * @returns {object|null}
 */
export function gheSelectedProxy(credentials, proxyOptions = null) {
  const binding = credentials?.providerSpecificData?.gheBinding;
  if (!binding || !Object.hasOwn(binding, "proxyOptions")) return proxyOptions || null;
  const signed = binding.proxyOptions || null;
  return isDeepStrictEqual(gheProxyRoute(signed), gheProxyRoute(proxyOptions)) ? signed : (proxyOptions || null);
}

/** Stored session expiry as epoch seconds; the shared refresh writer stores ISO text. */
function sessionExpirySeconds(value) {
  if (value == null || value === "") return undefined;
  if (isNumber(value)) return value > 1e12 ? Math.floor(value / 1000) : value;
  const ms = isString(value) ? Date.parse(value) : NaN;
  // An unreadable expiry stays unreadable so the binding refuses it.
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}

/**
 * Credentials with one numeric session expiry. Only the representation
 * changes; the binding still rejects a missing token or a past expiry.
 */
export function withSessionExpiry(credentials) {
  const data = credentials?.providerSpecificData || {};
  const expiry = sessionExpirySeconds(credentials?.copilotTokenExpiresAt ?? data.copilotTokenExpiresAt);
  if (expiry === undefined) return credentials;
  return { ...credentials, copilotTokenExpiresAt: expiry, providerSpecificData: { ...data, copilotTokenExpiresAt: expiry } };
}
