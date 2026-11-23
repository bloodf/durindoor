/**
 * Fail-closed proxy resolution for the impersonation TLS clients.
 * - per-call override wins.
 * - resolution returning a proxy → use it.
 * - resolution returning direct/null → undefined (direct is legitimate: no proxy set).
 * - resolution THROWING → rethrow. A configured-but-unusable proxy (e.g. socks5 with
 *   ENABLE_SOCKS5_PROXY=false, a strict relay pool, or strictProxy with no route)
 *   MUST NOT silently leak the real IP via a direct connection.
 */
export function resolveTlsClientProxyUrl(targetUrl, perCall, resolveProxyForRequest) {
  if (perCall && perCall.length > 0) return perCall;
  let info;
  try {
    info = resolveProxyForRequest(targetUrl);
  } catch (err) {
    throw new Error(
      `[TlsClient] Proxy resolution failed for ${targetUrl}; refusing direct connection (fail-closed): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (info?.source === "relay") {
    if (info.strict) {
      throw new Error(
        `[TlsClient] Configured HTTP relay does not support TLS client transport for ${targetUrl}`
      );
    }
    return undefined;
  }
  if (info?.strict && !info?.proxyUrl) {
    throw new Error(
      `[TlsClient] Proxy required but unavailable (strictProxy=true) for ${targetUrl}`
    );
  }
  return info && info.proxyUrl ? info.proxyUrl : undefined;
}
