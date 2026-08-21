import { NextResponse } from "next/server";
import { getSettings, validateApiKey, validateGatewayKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";

import {
  CONTROL_PORT_HEADER,
  CONTROL_PROOF_HEADER,
  verifyControlProof,
} from "@/mitm/controlProof";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

export async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

// Public API paths — no auth required (LLM API has its own key auth inside handler).
const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/init",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/oidc",
  "/api/version",
  "/api/settings/require-login",
];

// Public API paths matched by exact pathname only — no `/child` fallthrough.
// A prefix match here would let an attacker reach an unrelated route by
// nesting it under a trusted public prefix.
const PUBLIC_API_EXACT_PATHS = [
  // One-time password-change proof recipient. Only valid proofs can drive
  // a write here; the route does not fall through to a session check.
  "/api/auth/change-password",
];

// Public top-level prefixes (LLM API endpoints with their own API key auth).
const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex"];

// Always require JWT token regardless of requireLogin setting
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/version/shutdown",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
];

// Require auth, but allow through if requireLogin is disabled
const PROTECTED_API_PATHS = [
  "/api/settings",
  "/api/keys",
  "/api/providers",
  "/api/provider-nodes",
  "/api/proxy-pools",
  "/api/combos",
  "/api/models",
  "/api/usage",
  "/api/oauth",
  "/api/cloud",
  "/api/media-providers",
  "/api/pricing",
  "/api/tags",
  "/api/cli-tools",
  "/api/mcp",
  "/api/translator",
  "/api/tunnel",
];

// Routes that spawn child processes or read host secrets — restrict to localhost.
const LOCAL_ONLY_PATHS = [
  "/api/cli-tools/cowork-settings",
  "/api/cli-tools/antigravity-mitm",
  "/api/mcp/",
  "/api/tunnel/tailscale-install",
  "/api/tunnel/tailscale-enable",
  "/api/tunnel/tailscale-disable",
  "/api/tunnel/tailscale-check",
  "/api/tunnel/enable",
  "/api/tunnel/disable",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/auth/reset-password",
  "/api/headroom/start",
  "/api/headroom/stop",
  "/api/headroom/proxy",
  "/api/headroom/extras",
];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHostname(h) {
  if (!h) return false;
  let name = String(h).trim().toLowerCase();
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end === -1) return false;
    name = name.slice(1, end);
  } else if (name.indexOf(":") !== -1 && name.indexOf(":") === name.lastIndexOf(":")) {
    name = name.slice(0, name.indexOf(":"));
  }
  if (name.startsWith("::ffff:")) name = name.slice(7);
  return LOOPBACK_HOSTS.has(name);
}

// Stamped by custom-server.js: the request came through a reverse proxy, so the loopback
// socket is the proxy hop, not the end-user. Still proves it ran through the wrapper.
function hasViaProxyHeader(request) {
  return Boolean(request.headers.get("x-9r-via-proxy"));
}

// TCP socket says it was a loopback connection. The wrapper proof is required before
// any local classification; raw IP, Host, and Origin values are attacker-controlled.
function isLoopbackPeer(request) {
  if (hasViaProxyHeader(request)) return false;
  if (!hasTrustedPeerHeaders(request)) return false;
  const realIp = request.headers.get("x-9r-real-ip");
  if (realIp) return isLoopbackHostname(realIp);
  if (!isLoopbackHostname(request.headers.get("host"))) return false;
  return true;
}

// Restored strict origin check: expected origin = URL protocol + raw Host, exact
// normalized origin compare. Prevents a malicious loopback Origin from sliding past
// the same-origin guard under a benign Host (e.g. `localhost:20128.evil`).
function hasExactRequestOrigin(request) {
  const rawOrigin = request.headers.get("origin");
  const rawHost = request.headers.get("host");
  if (!rawOrigin || !rawHost) return false;
  try {
    const protocol = new URL(request.url).protocol;
    const expected = new URL(`${protocol}//${rawHost}`).origin;
    return new URL(rawOrigin).origin === expected;
  } catch {
    return false;
  }
}

// Wrapper proof plus the wrapper-stamped loopback identity distinguish local peers.
// Browser-origin checks belong at each mutation boundary, not this transport classifier.
export function isLocalRequest(request) {
  return isLoopbackPeer(request);
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function extractApiKey(request) {
  return extractApiKeyCandidates(request)[0] || null;
}

/** Collect distinct credentials presented by this request in precedence order. */
function extractApiKeyCandidates(request) {
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) add(authHeader.slice(7));
  add(request.headers.get("x-api-key"));
  add(request.headers.get("x-goog-api-key"));
  add(request.nextUrl.searchParams?.get("key"));
  return candidates;
}

async function hasValidApiKey(request) {
  for (const apiKey of extractApiKeyCandidates(request)) {
    if (await validateApiKey(apiKey)) return true;
  }
  return false;
}

async function hasValidGatewayKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return !!(await validateGatewayKey(apiKey));
}

async function canAccessPublicLlmApi(request) {
  if (isLocalRequest(request)) return true;
  if (await hasValidCliToken(request)) return true;
  if (await hasValidApiKey(request)) return true;
  // The dashboard itself reads model catalogs (`/api/models`, `/api/v1/models/*`)
  // to render provider/embedding grids. Those fetches carry the session cookie,
  // not an API key, and remote dashboards (e.g. over Tailscale) are not
  // `isLocalRequest`. Accept a valid dashboard JWT for SAFE (GET/HEAD) reads of
  // the model-list endpoints only — never for chat/completions or other LLM
  // traffic, which still require an API key.
  const method = String(request.method || "GET").toUpperCase();
  const pathname = request.nextUrl.pathname;
  const isModelListRead =
    (method === "GET" || method === "HEAD") &&
    (pathname === "/api/models" ||
      pathname === "/api/v1/models" ||
      pathname.startsWith("/api/v1/models/"));
  if (isModelListRead && (await hasValidToken(request))) return true;
  return false;
}

async function canAccessLocalOnlyRoute(request) {
  if (await hasValidCliToken(request)) return true;
  if (!isLocalRequest(request)) return false;

  const pathname = request.nextUrl.pathname;
  const method = String(request.method || "GET").toUpperCase();
  // Loopback identity is not browser authentication. Require the exact request
  // Origin for every unsafe mutation; machine-bound CLI callers passed above.
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !hasExactRequestOrigin(request)) return false;
  const isMitmMutation = (pathname === "/api/cli-tools/antigravity-mitm"
      || pathname.startsWith("/api/cli-tools/antigravity-mitm/"))
    && method !== "GET";
  if (isMitmMutation) {
    // Loopback and same-OS-user ownership are not authentication: a local
    // reverse proxy could otherwise become a confused deputy. Browser
    // mutations require a dashboard JWT; CLI callers were accepted above with
    // their machine-bound token. The owner proof remains defense in depth.
    if (!(await hasValidToken(request))) return false;
    return verifyControlProof({
      method: request.method,
      pathname,
      remotePort: request.headers.get(CONTROL_PORT_HEADER),
      proof: request.headers.get(CONTROL_PROOF_HEADER),
    });
  }

  // Other local-only routes retain the dashboard's normal login policy.
  if (await isAuthenticated(request)) return true;
  return false;
}

async function hasValidToken(request) {
  const token = request.cookies.get("auth_token")?.value;
  return await verifyDashboardAuthToken(token);
}

// Read settings directly from DB to avoid self-fetch deadlock in proxy
async function loadSettings() {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

async function isAuthenticated(request) {
  if (await hasValidToken(request)) return true;
  const settings = await loadSettings();
  if (settings && settings.requireLogin === false) return true;
  return false;
}

function isPxpipePath(pathname) {
  return pathname === "/api/pxpipe" || pathname.startsWith("/api/pxpipe/");
}

async function canAccessPxpipeRoute(request) {
  if (await hasValidCliToken(request)) return true;
  if (isLocalRequest(request)) return await isAuthenticated(request);
  return await hasValidToken(request);
}

function isPublicApi(pathname) {
  if (isPublicLlmApi(pathname)) return true;
  if (PUBLIC_API_EXACT_PATHS.includes(pathname)) return true;
  return PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const __test__ = {
  isLocalRequest,
  hasExactRequestOrigin,
  isPublicLlmApi,
  extractApiKey,
  extractApiKeyCandidates,
  canAccessPublicLlmApi,
  canAccessLocalOnlyRoute,
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // /api/mcp/control is a management MCP endpoint: it must always carry
  // either the local CLI token, a configured API key, or a valid dashboard
  // JWT, regardless of the requireLogin setting. This prevents an
  // unauthenticated remote caller from toggling providers when login is
  // disabled.
  if (pathname === "/api/mcp/control" || pathname.startsWith("/api/mcp/control/")) {
    if (await hasValidCliToken(request) || await hasValidApiKey(request) || await hasValidToken(request)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }


  if (isPxpipePath(pathname)) {
    if (await canAccessPxpipeRoute(request)) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Local-only gate for spawn-capable / host-secret routes.
  // /api/mcp/control is exempt: it is an authenticated management MCP endpoint
  // and must use the same dashboard JWT / CLI auth as the other dashboard APIs.
  const isMcpControlPath = pathname === "/api/mcp/control" || pathname.startsWith("/api/mcp/control/");
  if (!isMcpControlPath && LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  // Always protected - require valid JWT or local CLI token (machineId-based)
  if (ALWAYS_PROTECTED.some((p) => pathname.startsWith(p))) {
    if (await hasValidCliToken(request) || await hasValidToken(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /**
   * Browser preflights intentionally omit credentials, so answer only OPTIONS
   * for the existing public LLM path set before its API-key auth gate.
   */
  if (request.method === "OPTIONS" && isPublicLlmApi(pathname)) {
    const requestedHeaders = request.headers.get("access-control-request-headers");
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": requestedHeaders || "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (isPublicLlmApi(pathname)) {
    if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    if (pathname.includes("/v1/messages")) {
      return NextResponse.json({
        type: "error",
        error: {
          type: "authentication_error",
          message: "API key required for remote API access",
        },
      }, { status: 401 });
    }
    return NextResponse.json({ error: "API key required for remote API access" }, { status: 401 });
  }

  // MCP gateway: dedicated branch — only the exact MCP protocol surfaces
  // (`/api/mcp-gateway`, `/sse`, `/message`) accept a gateway API key.
  // CRUD subpaths (`/instances/*`, `/keys/*`) fall through to the standard
  // JWT/CLI auth below.
  const isGatewayProtocolSurface =
    pathname === "/api/mcp-gateway" ||
    pathname === "/api/mcp-gateway/sse" ||
    pathname === "/api/mcp-gateway/message";
  if (isGatewayProtocolSurface) {
    if (isLocalRequest(request)) return NextResponse.next();
    if (await hasValidCliToken(request)) return NextResponse.next();
    if (await hasValidGatewayKey(request)) return NextResponse.next();
    return NextResponse.json({ error: "gateway key required" }, { status: 401 });
  }

  // CIMD client-metadata document is fetched server-to-server by the upstream
  // OAuth authorization server (no dashboard session), so it must be public.
  // Only the exact `.../client-metadata` leaf is exempt — authorize/callback/
  // status stay behind the standard auth below.
  if (pathname.startsWith("/api/mcp-gateway/oauth/") && pathname.endsWith("/client-metadata")) {
    return NextResponse.next();
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();
    if (await hasValidCliToken(request) || await isAuthenticated(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    let requireLogin = true;
    let tunnelDashboardAccess = true;

    try {
      const settings = await loadSettings();
      if (settings) {
        requireLogin = settings.requireLogin !== false;
        tunnelDashboardAccess = settings.tunnelDashboardAccess === true;

        // Block tunnel/tailscale access if disabled (redirect to login)
        if (!tunnelDashboardAccess) {
          const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
          const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
          const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
          if ((tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost)) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        }
      }
    } catch {
      // On error, keep defaults (require login, block tunnel)
    }

    // If login not required, allow through
    if (!requireLogin) return NextResponse.next();

    // Verify JWT token
    const token = request.cookies.get("auth_token")?.value;
    if (token) {
      if (await verifyDashboardAuthToken(token)) {
        return NextResponse.next();
      } else {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect / to /dashboard if logged in, or /dashboard if it's the root
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}
