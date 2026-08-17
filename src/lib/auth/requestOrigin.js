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

// Split `host[:port]` (a Host header or a URL) into a lowercase hostname and an
// explicit port ("" when none was written). Scheme is deliberately excluded from
// the comparison below: a TLS-terminating tunnel/proxy (Cloudflare, Tailscale
// Serve, nginx) makes the upstream socket plain HTTP while the browser Origin is
// HTTPS, yet the request is still same-origin. The Host header is set by the
// proxy, not by an attacker's cross-site page, so host+port equality is the
// CSRF-relevant invariant.
function splitHostPort(hostOrUrl, { isUrl = false } = {}) {
  try {
    const url = isUrl ? new URL(hostOrUrl) : new URL(`http://${hostOrUrl}`);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname) return null;
    // url.port is "" for both a bare host and an explicit default (:80/:443).
    // Effective port resolves the scheme default for the Origin URL.
    const explicitPort = url.port;
    const effectivePort = explicitPort || (url.protocol === "https:" ? "443" : "80");
    return { hostname, explicitPort, effectivePort };
  } catch {
    return null;
  }
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

  // A browser Origin matching an operator-declared public base URL is trusted
  // even when a proxy rewrites the Host header to an internal name.
  if (configuredPublicOrigins().has(normalizedOrigin)) return true;

  const host = request.headers.get("host");
  if (!host) return false;

  const o = splitHostPort(origin, { isUrl: true });
  const h = splitHostPort(host);
  if (!o || !h) return false;
  if (o.hostname !== h.hostname) return false;
  // If the Host header names an explicit port, the Origin's effective port must
  // match it exactly (blocks a :20128 Host from accepting a :20129 Origin). If
  // the Host header omits the port, the Origin must resolve to a standard port
  // (80/443) — i.e. a proxy on the default port, not a stray custom port.
  if (h.explicitPort) return o.effectivePort === h.explicitPort;
  return o.effectivePort === "80" || o.effectivePort === "443";
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
