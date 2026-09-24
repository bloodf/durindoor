import { NextResponse } from "next/server";
import { getSettings, validateApiKey, validateGatewayKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";
import { timingSafeCompare } from "@/shared/utils/timingSafeCompare";

import {
  CONTROL_PORT_HEADER,
  CONTROL_PROOF_HEADER,
  verifyControlProof,
} from "@/mitm/controlProof";
import { isFunction } from "@/shared/utils/typeChecks.js";

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
  return timingSafeCompare(token, await getCliToken());
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
  // Login step 2 (decolua/9router#4144). Public by necessity -- the caller
  // holds no session yet, only the short-lived mfa_pending cookie, which the
  // route verifies itself. Exact path only, so /api/auth/mfa/{setup,enable,
  // disable} stay behind the normal session check below.
  "/api/auth/mfa/verify",
];

// Public top-level prefixes (LLM API endpoints with their own API key auth).
// Include root aliases because middleware classifies paths before Next.js rewrites.
const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex", "/responses"];

// Always require JWT token regardless of requireLogin setting
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/version/shutdown",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/oauth/xiaomi-mimo/auto-import",
];

// Management APIs — require JWT/CLI; loopback may use the open-dashboard
// requireLogin=false policy. Remote unauthenticated access is always denied.
const MANAGEMENT_API_PATHS = [
  "/api/settings",
  "/api/keys",
  "/api/providers",
  "/api/provider-nodes",
  "/api/proxy-pools",
  "/api/combos",
  "/api/connection-groups",
  "/api/models",
  "/api/usage",
  "/api/monitoring",
  "/api/timeline",
  "/api/oauth",
  "/api/cloud",
  "/api/media-providers",
  "/api/pricing",
  "/api/tags",
  "/api/cli-tools",
  "/api/mcp",
  // Gateway CRUD plus the operator-driven OAuth actions. The protocol surfaces
  // (`/api/mcp-gateway`, `/sse`, `/message`) keep gateway-key auth, and the
  // CIMD and callback leaves are answered earlier in proxy(): the callback is
  // an upstream browser redirect that carries no DurinDoor credential.
  "/api/mcp-gateway/keys",
  "/api/mcp-gateway/instances",
  "/api/mcp-gateway/oauth",
  "/api/translator",
  "/api/tunnel",
];

/**
 * Exact Headroom reads expose configured URLs, process/circuit state, and usage
 * data. Keep only these existing leaves on the management auth policy.
 */
const MANAGEMENT_API_EXACT_PATHS = ["/api/headroom/status", "/api/headroom/stats"];

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
  "/api/oauth/xiaomi-mimo/auto-import",
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

/**
 * True when the request carries an Origin that is NOT this server's own.
 *
 * The inverse of {@link hasExactRequestOrigin} for the credential-free local
 * case: a browser always attaches an Origin to a cross-origin POST, while
 * curl, the CLI, and MCP stdio clients attach none. Treating "absent" as
 * foreign would lock out exactly the same-machine agents the no-key path
 * exists to serve; treating "present but mismatched" as safe would leave the
 * CSRF hole open. An unparsable Origin counts as foreign.
 */
function hasForeignRequestOrigin(request) {
  if (!request.headers.get("origin")) return false;
  return !hasExactRequestOrigin(request);
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

/**
 * Access gate for LOCAL_ONLY_PATHS (spawn-capable / host-secret routes).
 *
 * Machine-bound CLI token always qualifies (including remote operator use).
 * Otherwise the peer must be loopback, mutations need an exact Origin, and
 * the dashboard login policy applies. Exported so MCP plugin handlers can
 * re-check in-process (defense in depth beyond the middleware proxy gate).
 *
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function canAccessLocalOnlyRoute(request) {
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

/**
 * True when the request carries a valid dashboard session JWT (`auth_token` cookie).
 * Exported so sensitive routes (e.g. database export/import) can require JWT+password
 * as a second factor beyond the ALWAYS_PROTECTED middleware gate.
 */
export async function hasValidToken(request) {
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

/**
 * Decode a pathname once, the way Next resolves it to a route.
 *
 * Every classifier in {@link proxy} MUST match on this value. Matching a raw
 * pathname while any sibling classifier matches a decoded one is fail-open: an
 * encoded character inside a strict suffix (`/api/keys/k1/%72eveal`,
 * `/api/oauth/cursor/%61uto-import`) would miss the strict list yet still hit
 * the broader management prefix, which now accepts an application API key.
 *
 * Returns null on malformed encoding so the caller can fail closed.
 *
 * @param {string} pathname
 * @returns {string|null}
 */
function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/**
 * Match exact management leaves as Next resolves them. Decode once so encoded
 * route spellings cannot bypass auth; malformed encoding fails closed.
 *
 * Both the exact list and the prefix list are matched on the decoded path: an
 * encoded separator (for example `/api/mcp%2Dgateway/oauth/i1/authorize`)
 * resolves to a management route in Next, so matching the raw path would drop
 * it onto the weaker generic gate.
 */
function isManagementApi(pathname) {
  const decodedPathname = decodePathname(pathname);
  if (decodedPathname === null) return true;
  if (MANAGEMENT_API_EXACT_PATHS.includes(decodedPathname)) return true;
  return MANAGEMENT_API_PATHS.some((p) => decodedPathname === p || decodedPathname.startsWith(`${p}/`));
}

/**
 * Resolve the action of an exact `/api/mcp-gateway/oauth/<id>/<action>` path.
 *
 * Returns null for anything else, so a deeper or malformed path (for example
 * `/api/mcp-gateway/oauth/a/b/callback`, which a suffix test would accept)
 * falls through to the management gate instead of an auth exemption. Decode
 * once so encoded spellings cannot bypass auth; malformed encoding fails
 * closed by returning null.
 *
 * @param {string} pathname
 * @returns {string|null}
 */
function gatewayOauthLeaf(pathname) {
  const decodedPathname = decodePathname(pathname);
  if (decodedPathname === null) return null;
  const segments = decodedPathname.split("/");
  // ["", "api", "mcp-gateway", "oauth", <id>, <action>]
  if (segments.length !== 6) return null;
  if (segments[1] !== "api" || segments[2] !== "mcp-gateway" || segments[3] !== "oauth") return null;
  if (!segments[4] || !segments[5]) return null;
  return segments[5];
}

/**
 * True when the request asks for a raw stored secret.
 *
 * Covers both spellings the handlers honor: a `/reveal` leaf and the
 * `?reveal=1` query the gateway key detail route reads
 * (`src/app/api/mcp-gateway/keys/[id]/route.js`). The path is matched decoded,
 * so `/api/keys/k1/%72eveal` cannot slip past as a plain management read.
 * Malformed encoding is treated as reveal, failing closed.
 *
 * @param {import("next/server").NextRequest} request
 * @returns {boolean}
 */
function isSecretRevealRequest(request) {
  if (request.nextUrl.searchParams?.get("reveal") === "1") return true;
  const decodedPathname = decodePathname(request.nextUrl.pathname);
  if (decodedPathname === null) return true;
  return decodedPathname === "/reveal" || decodedPathname.endsWith("/reveal");
}

/**
 * True when the caller is an operator rather than a programmatic API-key
 * client, and so may read stored proxy credentials verbatim.
 *
 * Qualifying principals are exactly the ones that could already reach these
 * values before the management API accepted application API keys: a dashboard
 * session, a machine-bound CLI token, or a loopback peer running an open
 * dashboard (`requireLogin === false`). That last case matters — the dashboard
 * round-trips `outboundProxyUrl` / `connectionProxyUrl` / `proxyUrl` through
 * its edit forms, so redacting them for an open local dashboard would persist
 * the redaction placeholder on the next save.
 *
 * An application API key is an inference credential and never qualifies.
 *
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function isOperatorRequest(request) {
  if (!request || !isFunction(request.headers?.get)) return false;
  try {
    if (await hasValidCliToken(request)) return true;
    if (await hasValidToken(request)) return true;
    // A presented API key is decisive, and it is checked before the
    // open-dashboard fallback: a programmatic client running on the host would
    // otherwise inherit operator reads whenever `requireLogin` is disabled.
    if (await hasValidApiKey(request)) return false;
    if (!isLocalRequest(request)) return false;
    const settings = await loadSettings();
    return Boolean(settings && settings.requireLogin === false);
  } catch {
    return false;
  }
}

/**
 * Management routes (providers, usage, keys, settings, …) must not trust the
 * global requireLogin=false bypass for remote callers. JWT and CLI token always
 * qualify; a valid DurinDoor application API key grants full programmatic
 * control; loopback peers keep open-dashboard usability when login is disabled.
 */
export async function canAccessManagementApi(request) {
  if (await hasValidCliToken(request)) return true;
  if (await hasValidToken(request)) return true;
  // Full programmatic control with the application API key — except raw secret
  // reveal, which stays JWT/CLI-only so a leaked LLM key cannot dump every
  // other credential. The loopback branch below is unchanged, so an open
  // dashboard on the host keeps its existing reveal behavior.
  if (!isSecretRevealRequest(request) && (await hasValidApiKey(request))) return true;
  if (isLocalRequest(request)) {
    const settings = await loadSettings();
    if (settings && settings.requireLogin === false) return true;
  }
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
  isManagementApi,
  canAccessManagementApi,
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Classify on the path Next actually resolves. A raw-vs-decoded split between
  // classifiers is fail-open: an encoded character inside a strict suffix
  // (`/api/oauth/cursor/%61uto-import`) would miss the strict list yet still
  // match the broader management prefix, which accepts an application API key.
  // Malformed encoding is rejected outright rather than guessed at.
  const routePath = decodePathname(pathname);
  if (routePath === null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // /api/mcp/control is a management MCP endpoint: a remote caller must always
  // carry the local CLI token, a configured API key, or a valid dashboard JWT,
  // regardless of the requireLogin setting. This prevents an unauthenticated
  // remote caller from toggling providers when login is disabled.
  if (routePath === "/api/mcp/control" || routePath.startsWith("/api/mcp/control/")) {
    if (await hasValidCliToken(request) || await hasValidApiKey(request) || await hasValidToken(request)) {
      return NextResponse.next();
    }
    // Same-machine agents skip the key exactly when the LLM endpoints do:
    // requireApiKey off. Loopback identity is not browser authentication,
    // though — the server stamps the trusted-peer header on every request,
    // including a browser's, so a page on a hostile origin could otherwise
    // drive these management tools from the victim's own machine.
    //
    // Reject only a *present, foreign* Origin. A browser always sends one on a
    // cross-origin POST, so this closes the CSRF path; curl, an MCP client, and
    // the CLI send none at all, so the plan's credential-free local agent keeps
    // working. Remote callers always need a credential.
    if (isLocalRequest(request) && !hasForeignRequestOrigin(request)) {
      const settings = await loadSettings();
      if (settings && settings.requireApiKey !== true) return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }


  if (isPxpipePath(routePath)) {
    if (await canAccessPxpipeRoute(request)) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Local-only gate for spawn-capable / host-secret routes.
  // /api/mcp/control is exempt: it is an authenticated management MCP endpoint
  // and must use the same dashboard JWT / CLI auth as the other dashboard APIs.
  const isMcpControlPath = routePath === "/api/mcp/control" || routePath.startsWith("/api/mcp/control/");
  if (!isMcpControlPath && LOCAL_ONLY_PATHS.some((p) => routePath.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  // Always protected - require valid JWT or local CLI token (machineId-based)
  if (ALWAYS_PROTECTED.some((p) => routePath.startsWith(p))) {
    if (await hasValidCliToken(request) || await hasValidToken(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /**
   * Browser preflights intentionally omit credentials, so answer only OPTIONS
   * for the existing public LLM path set before its API-key auth gate.
   */
  if (request.method === "OPTIONS" && isPublicLlmApi(routePath)) {
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

  if (isPublicLlmApi(routePath)) {
    if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    if (routePath.includes("/v1/messages")) {
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
    routePath === "/api/mcp-gateway" ||
    routePath === "/api/mcp-gateway/sse" ||
    routePath === "/api/mcp-gateway/message";
  if (isGatewayProtocolSurface) {
    if (isLocalRequest(request)) return NextResponse.next();
    if (await hasValidCliToken(request)) return NextResponse.next();
    if (await hasValidGatewayKey(request)) return NextResponse.next();
    return NextResponse.json({ error: "gateway key required" }, { status: 401 });
  }

  // Two gateway OAuth leaves carry no DurinDoor credential and so cannot sit
  // on the management gate: `client-metadata` is fetched server-to-server by
  // the upstream authorization server, and `callback` is the upstream browser
  // redirect, which keeps the dashboard's standard login policy and defends
  // itself with the server-side `state` it validates. `authorize` and `status`
  // are operator actions that fall through to the management gate below, so an
  // API-key client can drive a full OAuth connect flow.
  //
  // Match the exact `/api/mcp-gateway/oauth/<id>/<action>` shape on the decoded
  // path: a suffix test would exempt a deeper path such as
  // `/api/mcp-gateway/oauth/a/b/callback`. Malformed encoding fails closed.
  const oauthLeaf = gatewayOauthLeaf(routePath);
  if (oauthLeaf === "client-metadata") return NextResponse.next();
  if (oauthLeaf === "callback") {
    if (await hasValidCliToken(request) || await isAuthenticated(request)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  if (routePath.startsWith("/api/")) {
    if (isPublicApi(routePath)) return NextResponse.next();
    if (isManagementApi(routePath)) {
      if (await canAccessManagementApi(request)) return NextResponse.next();
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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

    // Serve the pre-rewrite dashboard when the reader has opted into it.
    // The rewrite happens only after the auth checks below have passed, so
    // the preview cannot become a way around them.
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
