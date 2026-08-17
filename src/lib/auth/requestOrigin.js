const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function hostMatchesLoopback(host) {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

function originHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function hasExactRequestOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;
  try {
    // Behind a TLS-terminating proxy/tunnel (Cloudflare, Tailscale Serve) the
    // socket is plain HTTP, so request.url is `http://` while the browser Origin
    // is `https://`. Trust the forwarded scheme when present, matching
    // shouldUseSecureCookie's convention, so a same-host HTTPS login is not
    // rejected as cross-origin.
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const scheme = (forwardedProto ? forwardedProto.split(",")[0].trim() : "") || new URL(request.url).protocol.replace(/:$/, "");
    return new URL(origin).origin === new URL(`${scheme}://${host}`).origin;
  } catch {
    return false;
  }
}
// Browser proof issuance requires an allowlisted loopback Host and Origin.
// A loopback socket alone is not sufficient: DNS rebinding controls Host and
// Origin while retaining the trusted peer address.
export function hasTrustedLocalOrigin(request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!host || !origin || !hostMatchesLoopback(host)) return false;
  // Browser proof issuance requires Origin and Host to be independently
  // allowlisted loopback names, preventing DNS rebinding through a local socket.
  return hostMatchesLoopback(originHost(origin));
}
