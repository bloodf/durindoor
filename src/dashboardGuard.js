import { isHosted } from "@/shared/utils/deploymentMode";
import { NextResponse } from "next/server";
import { getApiKeyByKey, getSettings, validateApiKey, validateGatewayKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";
import { originAbsentOrSame } from "@/lib/auth/requestOrigin";
import {
  classifyRoute,
  decodePathname,
  gatewayOauthLeaf,
  hasRouteTrait,
  isInRouteClass,
  isPublicLlmApi,
  matchesPrefix,
} from "@/lib/auth/routePolicy";
import { timingSafeCompare } from "@/shared/utils/timingSafeCompare";
import { checkLock, getClientIp, recordFail, recordSuccess } from "@/lib/auth/loginLimiter.js";

import {
  CONTROL_PORT_HEADER,
  CONTROL_PROOF_HEADER,
  verifyControlProof,
} from "@/mitm/controlProof";
import { isFunction } from "@/shared/utils/typeChecks.js";

export { matchesPrefix };

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

// Share the login/auth routes' explicit public-origin convention for TLS
// terminators, while retaining an explicit Origin requirement for local proofs.
export function originPresentAndSame(request) {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin || !request.headers.get("host")) return false;
  try {
    const loginOrigin = process.env.DURINDOOR_WEB_LOGIN_ORIGIN;
    if (loginOrigin && new URL(rawOrigin).hostname.toLowerCase().replace(/\.$/, "") ===
        new URL(loginOrigin).hostname.toLowerCase().replace(/\.$/, "")) return false;
  } catch {
    // Invalid login configuration cannot establish a trusted login origin.
    // The shared helper still rejects malformed request Origins below.
  }
  return Boolean(request.headers.get("origin")) && originAbsentOrSame(request);
}
// Kept for existing test fixtures and out-of-scope integrations.
export const hasExactRequestOrigin = originPresentAndSame;

/**
 * True when the request carries an Origin that is NOT this server's own.
 *
 * The inverse of {@link originPresentAndSame} for the credential-free local
 * case: a browser always attaches an Origin to a cross-origin POST, while
 * curl, the CLI, and MCP stdio clients attach none. Treating "absent" as
 * foreign would lock out exactly the same-machine agents the no-key path
 * exists to serve; treating "present but mismatched" as safe would leave the
 * CSRF hole open. An unparsable Origin counts as foreign.
 */
function hasForeignRequestOrigin(request) {
  if (!request.headers.get("origin")) return false;
  return !originPresentAndSame(request);
}

// DNS rebinding keeps the loopback socket (and trusted peer headers) while the
// attacker controls Host and Origin. The credential-free loopback gates therefore
// also require a loopback Host, and a loopback Origin whenever one is sent.
// No Origin (curl, CLI, MCP stdio) stays allowed.
function hasLoopbackHostAndOrigin(request) {
  if (!isLoopbackHostname(request.headers.get("host"))) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// Wrapper proof plus the wrapper-stamped loopback identity distinguish local peers.
// Browser-origin checks belong at each mutation boundary, not this transport classifier.
export function isLocalRequest(request) {
  return !isHosted() && isLoopbackPeer(request);
}

function extractApiKey(request) {
  return extractApiKeyCandidates(request)[0] || null;
}

/**
 * Collect distinct credentials presented by this request in precedence order.
 * `includeQuery: false` skips the `?key=` query credential (URLs leak into
 * logs and history, so it never carries the admin scope).
 */
function extractApiKeyCandidates(request, { includeQuery = true } = {}) {
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) add(authHeader.slice(7));
  add(request.headers.get("x-api-key"));
  add(request.headers.get("x-goog-api-key"));
  if (includeQuery) add(request.nextUrl?.searchParams?.get("key"));
  return candidates;
}

async function hasValidApiKey(request) {
  for (const apiKey of extractApiKeyCandidates(request)) {
    if (await validateApiKey(apiKey)) return true;
  }
  return false;
}

/**
 * True when the request presents an active, unexpired application API key
 * that carries the explicit admin scope in a header (`?key=` never counts).
 * Fails closed on lookup errors.
 *
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function isAdminScopedKey(request) {
  if (!request || !isFunction(request.headers?.get)) return false;
  try {
    for (const apiKey of extractApiKeyCandidates(request, { includeQuery: false })) {
      if (!(await validateApiKey(apiKey))) continue;
      if ((await getApiKeyByKey(apiKey))?.isAdmin === true) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isSafeMethod(request) {
  return ["GET", "HEAD", "OPTIONS"].includes(String(request.method || "GET").toUpperCase());
}

/**
 * True when a management request changes state: any unsafe method, or an
 * OAuth action. Malformed encoding counts as a change, failing closed.
 */
function isManagementChange(request) {
  if (!isSafeMethod(request)) return true;
  return hasRouteTrait(request.nextUrl.pathname, "oauth-action");
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
  const isModelListRead = (method === "GET" || method === "HEAD") && hasRouteTrait(pathname, "model-list");
  if (isModelListRead && (await hasValidToken(request))) return true;
  return false;
}

/**
 * Access gate for `local-only` routes (spawn-capable / host-secret).
 *
 * Machine-bound CLI token always qualifies (including remote operator use).
 * Otherwise the peer must be loopback, mutations need an exact Origin, and
 * the dashboard login policy applies. Exported so MCP plugin handlers can
 * re-check in-process (defense in depth beyond the middleware proxy gate).
 *
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function canAccessLocalOnlyRoute(request, routePath = decodePathname(request.nextUrl.pathname)) {
  if (routePath === null || isHosted()) return false;
  if (await hasValidCliToken(request)) return true;
  // Tunnel controls accept an authenticated dashboard session on its own origin.
  if (hasRouteTrait(request.nextUrl.pathname, "session-tunnel-control") &&
      originPresentAndSame(request) && await hasValidToken(request)) return true;
  if (!isLocalRequest(request)) return false;

  const pathname = routePath;
  const method = String(request.method || "GET").toUpperCase();
  // Loopback identity is not browser authentication. Require the exact request
  // Origin for every unsafe mutation; machine-bound CLI callers passed above.
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !originPresentAndSame(request)) return false;
  const isMitmMutation = matchesPrefix(pathname, "/api/cli-tools/antigravity-mitm")
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
 * as a second factor beyond the `always-protected` middleware gate.
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
  // The open-dashboard fallback is credential-free, so require the same
  // loopback Host/Origin proof as the other local access gates.
  if (settings && settings.requireLogin === false && hasLoopbackHostAndOrigin(request)) return true;
  return false;
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
    if (hasForeignRequestOrigin(request)) return false;
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
 * Principal check for management changes: an operator (see
 * {@link isOperatorRequest}) or an admin-scoped application API key. Used by
 * the management gate for unsafe methods, by key, provider-node and connection
 * routing writes, and by MCP control write tools.
 *
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function canManageAccessConfig(request) {
  return (await isOperatorRequest(request)) || (await isAdminScopedKey(request));
}

/**
 * Management routes (providers, usage, keys, settings, …) must not trust the
 * global requireLogin=false bypass for remote callers. JWT and CLI token always
 * qualify; a valid DurinDoor application API key grants full programmatic
 * control; loopback peers keep open-dashboard usability when login is disabled.
 */
export async function canAccessManagementApi(request) {
  if (await hasValidCliToken(request)) return true;
  if (hasForeignRequestOrigin(request)) {
    return !isSecretRevealRequest(request) && (await canUseApiKeyForManagement(request));
  }
  if (await hasValidToken(request)) return true;
  // Programmatic control with the application API key — except raw secret
  // reveal, which stays JWT/CLI-only so a leaked LLM key cannot dump every
  // other credential. Reads accept any active key; changes need the admin
  // scope, and a presented key without it is decisive (no loopback fallback).
  // The loopback branch below is unchanged, so an open dashboard on the host
  // keeps its existing reveal behavior.
  if (!isSecretRevealRequest(request) && (await hasValidApiKey(request))) {
    return await canUseApiKeyForManagement(request);
  }
  if (isLocalRequest(request) && hasLoopbackHostAndOrigin(request)) {
    const settings = await loadSettings();
    if (settings && settings.requireLogin === false) return true;
  }
  return false;
}

/**
 * True when the caller's only management credential is an application API key
 * without the admin scope. Callers the gate admitted without a key (CLI token,
 * session, credential-free local agent) are not affected.
 *
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function isNonAdminApiKeyCaller(request) {
  if (!request || !isFunction(request.headers?.get)) return false;
  try {
    if (!(await hasValidApiKey(request))) return false;
    return !(await canManageAccessConfig(request));
  } catch {
    return true;
  }
}

async function canUseApiKeyForManagement(request) {
  if (!(await hasValidApiKey(request))) return false;
  if (await isAdminScopedKey(request)) return true;
  // The self-usage endpoint is deliberately scoped to the presented key and
  // remains available to inference clients without management privileges.
  const pathname = decodePathname(request.nextUrl?.pathname || "");
  if (pathname === "/api/usage/me" && isSafeMethod(request)) return true;
  return false;
}

async function canAccessPxpipeRoute(request) {
  if (await hasValidCliToken(request)) return true;
  if (isLocalRequest(request) && hasLoopbackHostAndOrigin(request)) return await isAuthenticated(request);
  return await hasValidToken(request);
}

/**
 * True when the request carries a present Origin whose hostname is not
 * loopback. Port and scheme are ignored (https://localhost:20128 and
 * http://localhost:20129 stay local). Unparsable Origins count as non-loopback.
 */
function hasNonLoopbackRequestOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return !isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return true;
  }
}

function isPublicApi(pathname, method = "GET") {
  return isInRouteClass(pathname, "public", method);
}

function isManagementApi(pathname) {
  return isInRouteClass(pathname, "management");
}

export const __test__ = {
  isLocalRequest,
  hasExactRequestOrigin,
  originPresentAndSame,
  matchesPrefix,
  classifyRoutePolicy: classifyRoute,
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

  // First-match class. Gates that overlap (management, local-only,
  // always-protected) ask for class membership instead.
  const routeClass = classifyRoute(routePath, request.method);

  // A same-site sibling login host can carry dashboard cookies. Origin, not
  // SameSite, is the boundary for management writes and credential-bearing
  // reads. Explicit programmatic credentials retain their existing policy;
  // downstream gates still restrict raw secret reveals and local-only tools.
  //
  // A valid API key lifts the block only when no dashboard cookie rides along,
  // or when the key alone authorizes the route (management API, MCP control).
  // Otherwise a throwaway `?key=` would turn the gate off for routes that
  // authorize on the operator's cookie.
  if (routePath.startsWith("/api/") && !isPublicApi(routePath, request.method) &&
      hasForeignRequestOrigin(request) && !(await hasValidCliToken(request))) {
    const keyAuthorizesRoute = isManagementApi(routePath) || routeClass === "mcp-control";
    const hasKey = await hasValidApiKey(request);
    const hasDashboardCookie = Boolean(request.cookies?.get?.("auth_token")?.value);
    if (!hasKey || (hasDashboardCookie && !keyAuthorizesRoute)) {
      return NextResponse.json({ error: "Cross-origin management request denied" }, { status: 403 });
    }
  }

  // /api/mcp/control is a management MCP endpoint: a remote caller must always
  // carry the local CLI token, a configured API key, or a valid dashboard JWT,
  // regardless of the requireLogin setting. This prevents an unauthenticated
  // remote caller from toggling providers when login is disabled.
  if (routeClass === "mcp-control") {
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
    if (isLocalRequest(request) && hasLoopbackHostAndOrigin(request) && !hasForeignRequestOrigin(request)) {
      const settings = await loadSettings();
      if (settings && settings.requireApiKey !== true) return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }


  if (routeClass === "pxpipe") {
    if (await canAccessPxpipeRoute(request)) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Local-only gate for spawn-capable / host-secret routes.
  // /api/mcp/control never reaches it: it is an authenticated management MCP
  // endpoint, answered by its own branch above.
  if (isInRouteClass(routePath, "local-only")) {
    if (!(await canAccessLocalOnlyRoute(request, routePath))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  // Always protected - require valid JWT or local CLI token (machineId-based)
  if (routeClass === "always-protected") {
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
    const method = String(request.method || "GET").toUpperCase();
    const isModelListRead = (method === "GET" || method === "HEAD") && hasRouteTrait(routePath, "model-list");
    const hasLegacyKeyCandidate = extractApiKeyCandidates(request)
      .some((apiKey) => /^sk-[0-9a-f]{8}$/i.test(apiKey));
    if (!isLocalRequest(request) && hasLegacyKeyCandidate && !(await hasValidCliToken(request)) &&
        !(isModelListRead && await hasValidToken(request))) {
      const ip = `key:${getClientIp(request)}`;
      if (await hasValidApiKey(request)) {
        recordSuccess(ip);
      } else {
        const lock = checkLock(ip);
        if (lock.locked) {
          return NextResponse.json({ error: "Too many failed API key attempts" }, {
            status: 429,
            headers: { "Retry-After": String(lock.retryAfter) },
          });
        }
        recordFail(ip);
      }
    }
    // Loopback identity is not browser authentication: a web page the operator
    // visits reaches the gateway from their own machine. Reject a credential-free
    // local caller that sends a present Origin whose hostname is not loopback,
    // matching /api/mcp/control's foreign-Origin rule for browsers. Port and
    // scheme differences on localhost stay accepted (see #3294). Explicit CLI
    // token / API key callers keep CORS; curl and SDKs send no Origin at all.
    if (isLocalRequest(request) && hasNonLoopbackRequestOrigin(request) &&
        !(await hasValidCliToken(request)) && !(await hasValidApiKey(request))) {
      return NextResponse.json({ error: "Cross-origin request without credentials denied" }, { status: 403 });
    }
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
  if (routeClass === "gateway-key") {
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
    // This upstream browser redirect intentionally follows the dashboard
    // login policy even for a remote authorization server callback.
    const settings = await loadSettings();
    if (await hasValidCliToken(request) || await hasValidToken(request) ||
        (settings && settings.requireLogin === false)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  if (routePath.startsWith("/api/")) {
    if (isPublicApi(routePath, request.method)) return NextResponse.next();
    if (isManagementApi(routePath)) {
      if (await canAccessManagementApi(request)) return NextResponse.next();
      if (isManagementChange(request) && (await hasValidApiKey(request))) {
        return NextResponse.json({ error: "This API key lacks the admin scope required for management changes" }, { status: 403 });
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // The open-dashboard policy (requireLogin=false) applies to loopback peers
    // only; remote callers need a CLI token or a dashboard session.
    if (await hasValidCliToken(request) || await hasValidToken(request))
      return NextResponse.next();
    if (isLocalRequest(request) && await isAuthenticated(request))
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
            return NextResponse.redirect(new URL(`${request.nextUrl.basePath || ""}/login`, request.url));
          }
        }
      }
    } catch {
      // On error, keep defaults (require login, block tunnel)
    }

    // Serve the pre-rewrite dashboard when the reader has opted into it.
    // The rewrite happens only after the auth checks below have passed, so
    // the preview cannot become a way around them.
    if (!requireLogin && isLocalRequest(request)) return NextResponse.next();

    // Verify JWT token
    const token = request.cookies.get("auth_token")?.value;
    if (token) {
      if (await verifyDashboardAuthToken(token)) {
        return NextResponse.next();
      } else {
        return NextResponse.redirect(new URL(`${request.nextUrl.basePath || ""}/login`, request.url));
      }
    }

    return NextResponse.redirect(new URL(`${request.nextUrl.basePath || ""}/login`, request.url));
  }

  // Redirect / to /dashboard if logged in, or /dashboard if it's the root
  if (pathname === "/") {
    return NextResponse.redirect(new URL(`${request.nextUrl.basePath || ""}/dashboard`, request.url));
  }

  return NextResponse.next();
}
