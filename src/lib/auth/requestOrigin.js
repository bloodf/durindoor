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
    return new URL(origin).origin === new URL(`${new URL(request.url).protocol}//${host}`).origin;
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
