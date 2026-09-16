import { isString } from "./typeChecks.js";

/** Placeholder substituted for proxy userinfo that a caller may not read. */
export const REDACTED_PROXY_CREDENTIAL = "***";

/**
 * Strip the `user:password@` userinfo from a proxy URL, keeping the rest of
 * the URL readable.
 *
 * Proxy URLs are operational configuration an agent legitimately inspects
 * (which host, which port, is one configured at all), but their userinfo is a
 * live credential. Dashboard sessions and CLI callers still read the full
 * value; an application API key sees the host without the secret.
 *
 * A value that does not parse as a URL is reported as fully redacted rather
 * than echoed, since an unparsable string may still embed credentials.
 *
 * @param {unknown} value
 * @returns {unknown} the redacted URL, or the input when there is nothing to redact
 */
export function redactProxyUrlCredentials(value) {
  if (!isString(value) || value === "") return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return REDACTED_PROXY_CREDENTIAL;
  }
  // `new URL` accepts non-hierarchical strings: "user:pass@host" parses as
  // scheme `user:` with an empty host and no userinfo, so a bare `username`
  // test would echo the credential. A proxy URL always has a host; anything
  // without one is reported as fully redacted rather than returned.
  if (!url.host) return REDACTED_PROXY_CREDENTIAL;
  if (!url.username && !url.password) return value;
  if (url.username) url.username = REDACTED_PROXY_CREDENTIAL;
  if (url.password) url.password = REDACTED_PROXY_CREDENTIAL;
  return url.toString();
}

/**
 * Redact a proxy pool's `proxyUrl` unless the caller proved operator identity.
 *
 * Shared by the list and detail routes so a pool can never be read verbatim
 * through one endpoint after being redacted on the other.
 *
 * @param {object} pool
 * @param {boolean} privileged dashboard JWT or CLI token
 */
export function sanitizeProxyPool(pool, privileged) {
  if (privileged || !pool?.proxyUrl) return pool;
  return { ...pool, proxyUrl: redactProxyUrlCredentials(pool.proxyUrl) };
}

/**
 * Redact `providerSpecificData.connectionProxyUrl` unless the caller proved
 * operator identity. The value round-trips through the dashboard's edit form,
 * so it is redacted rather than dropped.
 *
 * @param {object} connection an already secret-sanitized connection
 * @param {boolean} privileged dashboard JWT or CLI token
 */
export function sanitizeConnectionProxyUrl(connection, privileged) {
  const proxyUrl = connection?.providerSpecificData?.connectionProxyUrl;
  if (privileged || !proxyUrl) return connection;
  return {
    ...connection,
    providerSpecificData: {
      ...connection.providerSpecificData,
      connectionProxyUrl: redactProxyUrlCredentials(proxyUrl),
    },
  };
}
