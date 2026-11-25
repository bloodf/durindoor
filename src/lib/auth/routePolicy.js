/**
 * Declarative route policy for the dashboard guard: the one place that says
 * which paths belong to which auth gate.
 *
 * ORDER MATTERS. {@link classifyRoute} returns the class of the first entry that
 * matches, and `session` when none does. Classes also overlap on purpose (the
 * auto-import routes are always-protected, local-only AND management), and
 * `proxy()` stacks or consults several gates for such a path. Gates that need
 * "does this path belong to class X" use {@link isInRouteClass}, not the
 * first-match class.
 *
 * Entry fields:
 * - `match`: `exact`, `prefix` (segment-aware, see {@link matchesPrefix}) or
 *   `oauthLeaf` (the action of `/api/mcp-gateway/oauth/<id>/<action>`)
 * - `path`: the path, prefix or leaf action
 * - `class`: the policy class
 * - `decoded`: match on the path decoded once more; malformed encoding matches
 *   (fail closed)
 * - `methods`: the entry applies to these methods only
 * - `llm`: a public LLM endpoint, with its own API key auth
 */

const entries = (match, routeClass, paths, notes, extra = {}) =>
  paths.map((path) => Object.freeze({ match, path, class: routeClass, notes, ...extra }));
const exact = (...args) => entries("exact", ...args);
const prefix = (...args) => entries("prefix", ...args);
const oauthLeaf = (...args) => entries("oauthLeaf", ...args);

export const ROUTE_POLICIES = Object.freeze([
  // A management MCP endpoint with its own credential rules.
  ...prefix("mcp-control", ["/api/mcp/control"], "credential always required unless local and keyless"),
  ...prefix("pxpipe", ["/api/pxpipe"], "CLI token, session, or local login policy"),

  // Public LLM API endpoints with their own API key auth.
  ...exact("public", ["/backend-api/codex/alpha/search"], "public LLM endpoint", { llm: true }),
  // Include root aliases because middleware classifies paths before Next.js rewrites.
  ...prefix("public", ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex", "/responses"],
    "public LLM endpoints and root aliases", { llm: true }),

  // Public API paths matched by exact pathname only — no `/child` fallthrough.
  // A prefix match here would let an attacker reach an unrelated route by
  // nesting it under a trusted public prefix.
  // Orchestrator probes (Kubernetes liveness/readiness). All answer only
  // {"ok":true}; exact match so nothing can be nested under them (for example,
  // /api/health/providers stays behind the management gate).
  ...exact("public", ["/api/deployment-mode", "/api/health"], "probe"),
  // Version probe (GET only). Exact match: its children (`/update`,
  // `/shutdown`) are operator actions and must get the Origin gate, and
  // POST/PUT/etc. must not inherit the allow-list.
  ...exact("public", ["/api/version"], "version probe, GET only", { methods: Object.freeze(["GET"]) }),
  ...exact("public", ["/api/livez", "/api/readyz"], "probe"),
  ...exact("public", ["/api/auth/oidc/start", "/api/auth/oidc/callback"], "OIDC login flow"),
  // Only valid proofs can drive a write here; the route does not fall through
  // to a session check.
  ...exact("public", ["/api/auth/change-password"], "one-time password-change proof recipient"),
  // Login step 2 (decolua/9router#4144). Public by necessity -- the caller
  // holds no session yet, only the short-lived mfa_pending cookie, which the
  // route verifies itself. Exact path only, so /api/auth/mfa/{setup,enable,
  // disable} stay behind the normal session check.
  ...exact("public", ["/api/auth/mfa/verify"], "login step 2"),
  // Browser-extension cookie import. The caller holds no dashboard session or
  // API key, only a one-use pairing secret the route itself consumes
  // (src/lib/providers/cookieImport/README.md). Exact path only: the operator
  // route that issues pairings (`/pairing`) stays behind the management gate.
  ...exact("public", ["/api/providers/cookie-import"], "one-use pairing secret"),

  // Public API paths — no auth required.
  ...prefix("public", [
    "/api/init",
    "/api/locale",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/status",
    "/api/settings/require-login",
  ], "no auth required"),

  // Always require JWT or CLI token regardless of the requireLogin setting.
  ...prefix("always-protected", [
    "/api/shutdown",
    "/api/settings/database",
    "/api/version/shutdown",
    "/api/version/update",
    "/api/oauth/cursor/auto-import",
    "/api/oauth/commandcode/auto-import",
    "/api/oauth/kiro/auto-import",
    "/api/oauth/xiaomi-mimo/auto-import",
  ], "JWT or CLI token only"),

  // Routes that spawn child processes or read host secrets — restrict to localhost.
  ...prefix("local-only", [
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
    "/api/oauth/commandcode/auto-import",
    "/api/oauth/kiro/auto-import",
    "/api/oauth/xiaomi-mimo/auto-import",
    "/api/auth/reset-password",
    "/api/headroom/start",
    "/api/headroom/stop",
    "/api/headroom/proxy",
    "/api/headroom/extras",
  ], "spawns processes or reads host secrets"),

  // Only the exact MCP protocol surfaces accept a gateway API key.
  ...exact("gateway-key", ["/api/mcp-gateway", "/api/mcp-gateway/sse", "/api/mcp-gateway/message"],
    "MCP gateway protocol surface"),

  // Two gateway OAuth leaves carry no DurinDoor credential and so cannot sit on
  // the management gate. They are not part of the public API allow-list, so the
  // cross-origin gate still applies to them.
  ...oauthLeaf("public", ["client-metadata"], "fetched server-to-server by the upstream authorization server"),
  ...oauthLeaf("session", ["callback"], "upstream browser redirect; dashboard login policy"),

  // Exact management leaves expose operational state or exercise stored secrets.
  // OIDC start/callback and /api/health remain public; testing issuer
  // credentials and inspecting provider health do not.
  ...exact("management", [
    "/api/headroom/status",
    "/api/headroom/stats",
    "/api/auth/oidc/test",
    "/api/health/providers",
  ], "operational state or stored secrets", { decoded: true }),
  // Management APIs — require JWT/CLI/API key; loopback may use the
  // open-dashboard requireLogin=false policy. Remote unauthenticated access is
  // always denied.
  ...prefix("management", [
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
    // Gateway CRUD plus the operator-driven OAuth actions. The protocol
    // surfaces keep gateway-key auth, and the CIMD and callback leaves are
    // answered earlier in proxy(): the callback is an upstream browser redirect
    // that carries no DurinDoor credential.
    "/api/mcp-gateway/keys",
    "/api/mcp-gateway/instances",
    "/api/mcp-gateway/oauth",
    "/api/translator",
    "/api/tunnel",
  ], "management API", { decoded: true }),
]);

/**
 * Properties that refine a gate's behavior. They are orthogonal to the policy
 * class, so they never take part in first-match classification.
 */
export const ROUTE_TRAITS = Object.freeze([
  // OAuth actions start, poll, and stop credential flows even over GET.
  ...prefix("oauth-action", ["/api/oauth/", "/api/mcp-gateway/oauth/"],
    "changes state even over GET", { decoded: true }),
  ...exact("model-list", ["/api/models"], "dashboard session may read the model catalog"),
  ...prefix("model-list", ["/api/v1/models"], "dashboard session may read the model catalog"),
  ...exact("session-tunnel-control", ["/api/tunnel/enable", "/api/tunnel/disable"],
    "same-origin dashboard session passes the local-only gate"),
]);

/**
 * Decode a pathname once, the way Next resolves it to a route.
 *
 * Every classifier in the guard's `proxy()` MUST match on this value. Matching a
 * raw pathname while any sibling classifier matches a decoded one is fail-open:
 * an encoded character inside a strict suffix (`/api/keys/k1/%72eveal`,
 * `/api/oauth/cursor/%61uto-import`) would miss the strict entry yet still hit
 * the broader management prefix, which accepts an application API key.
 *
 * Returns null on malformed encoding so the caller can fail closed.
 *
 * @param {string} pathname
 * @returns {string|null}
 */
export function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

export function matchesPrefix(path, prefix) {
  if (prefix.endsWith("/")) return path.startsWith(prefix);
  const normalized = prefix;
  return path === normalized || path.startsWith(`${normalized}/`);
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
export function gatewayOauthLeaf(pathname) {
  const decodedPathname = decodePathname(pathname);
  if (decodedPathname === null) return null;
  const segments = decodedPathname.split("/");
  // ["", "api", "mcp-gateway", "oauth", <id>, <action>]
  if (segments.length !== 6) return null;
  if (segments[1] !== "api" || segments[2] !== "mcp-gateway" || segments[3] !== "oauth") return null;
  if (!segments[4] || !segments[5]) return null;
  return segments[5];
}

function entryMatches(entry, path, method) {
  if (entry.methods && !entry.methods.includes(String(method || "GET").toUpperCase())) return false;
  if (entry.match === "oauthLeaf") return gatewayOauthLeaf(path) === entry.path;
  // Decoding catches encoded separators (`/api/mcp%2Dgateway/...`) that resolve
  // to a protected route in Next.
  const candidate = entry.decoded ? decodePathname(path) : path;
  if (candidate === null) return true;
  return entry.match === "exact" ? candidate === entry.path : matchesPrefix(candidate, entry.path);
}

/**
 * The policy class of the first table entry that matches, else `session`.
 *
 * @param {string} path
 * @param {string} [method]
 * @returns {string}
 */
export function classifyRoute(path, method = "GET") {
  return ROUTE_POLICIES.find((entry) => entryMatches(entry, path, method))?.class ?? "session";
}

/**
 * True when any path entry of `routeClass` matches, whatever an earlier entry
 * says. The OAuth leaf exemptions are not path entries and do not count: in
 * particular `client-metadata` is not on the public allow-list.
 *
 * @param {string} path
 * @param {string} routeClass
 * @param {string} [method]
 * @returns {boolean}
 */
export function isInRouteClass(path, routeClass, method = "GET") {
  return ROUTE_POLICIES.some((entry) =>
    entry.class === routeClass && entry.match !== "oauthLeaf" && entryMatches(entry, path, method));
}

export function isPublicLlmApi(path) {
  return ROUTE_POLICIES.some((entry) => entry.llm && entryMatches(entry, path));
}

export function hasRouteTrait(path, trait) {
  return ROUTE_TRAITS.some((entry) => entry.class === trait && entryMatches(entry, path));
}
