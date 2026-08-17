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

// Origins the operator has declared as this deployment's public address.
// custom-server.js strips client-forgeable x-forwarded-* at the boundary, so a
// TLS-terminating tunnel/proxy (Cloudflare, Tailscale) cannot be recognized from
// request headers — the public origin must come from operator-set config. These
// env values are trusted (not request-controlled).
function configuredPublicOrigins() {
  const origins = new Set();
  for (const raw of [process.env.BASE_URL, process.env.NEXT_PUBLIC_BASE_URL]) {
    if (!raw) continue;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      // ignore malformed config
    }
  }
  return origins;
}

export function hasExactRequestOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  let normalizedOrigin;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  // A browser Origin matching the configured public base URL is trusted even
  // when the upstream socket is plain HTTP behind a TLS-terminating tunnel.
  if (configuredPublicOrigins().has(normalizedOrigin)) return true;

  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return normalizedOrigin === new URL(`${new URL(request.url).protocol}//${host}`).origin;
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
