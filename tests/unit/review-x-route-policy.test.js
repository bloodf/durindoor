import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROUTE_POLICIES, ROUTE_TRAITS, classifyRoute, gatewayOauthLeaf, hasRouteTrait,
  isInRouteClass, isPublicLlmApi,
} from "../../src/lib/auth/routePolicy.js";
import { __test__, matchesPrefix } from "../../src/dashboardGuard.js";

// ---- Frozen oracle: the list logic of dashboardGuard.js before the route table. ----
// Do not "fix" or regenerate this from the table; it is the reference behavior.
const PUBLIC_API_PATHS = [
  "/api/init",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/settings/require-login",
];
const PUBLIC_API_EXACT_PATHS = [
  "/api/deployment-mode",
  "/api/health",
  "/api/version",
  "/api/livez",
  "/api/readyz",
  "/api/auth/oidc/start",
  "/api/auth/oidc/callback",
  "/api/auth/change-password",
  "/api/auth/mfa/verify",
  "/api/providers/cookie-import",
];
const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex", "/responses"];
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/version/shutdown",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/commandcode/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/oauth/xiaomi-mimo/auto-import",
];
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
  "/api/mcp-gateway/keys",
  "/api/mcp-gateway/instances",
  "/api/mcp-gateway/oauth",
  "/api/translator",
  "/api/tunnel",
];
const MANAGEMENT_API_EXACT_PATHS = [
  "/api/headroom/status",
  "/api/headroom/stats",
  "/api/auth/oidc/test",
  "/api/health/providers",
];
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
  "/api/oauth/commandcode/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/oauth/xiaomi-mimo/auto-import",
  "/api/auth/reset-password",
  "/api/headroom/start",
  "/api/headroom/stop",
  "/api/headroom/proxy",
  "/api/headroom/extras",
];
const OAUTH_ACTION_PREFIXES = ["/api/oauth/", "/api/mcp-gateway/oauth/"];

const GATEWAY_SURFACES = ["/api/mcp-gateway", "/api/mcp-gateway/sse", "/api/mcp-gateway/message"];
const TUNNEL_SESSION_PATHS = ["/api/tunnel/enable", "/api/tunnel/disable"];

function oldDecode(pathname) {
  try { return decodeURIComponent(pathname); } catch { return null; }
}
function oldMatchesPrefix(value, prefix) {
  if (prefix.endsWith("/")) return value.startsWith(prefix);
  return value === prefix || value.startsWith(`${prefix}/`);
}
const under = (list, value) => list.some((p) => oldMatchesPrefix(value, p));
const oldIsPublicLlm = (p) => p === "/backend-api/codex/alpha/search" || under(PUBLIC_PREFIXES, p);
function oldIsPublicApi(p, method = "GET") {
  if (oldIsPublicLlm(p)) return true;
  if (PUBLIC_API_EXACT_PATHS.includes(p)) {
    if (p === "/api/version") return String(method || "GET").toUpperCase() === "GET";
    return true;
  }
  return under(PUBLIC_API_PATHS, p);
}
function oldIsManagement(p) {
  const decoded = oldDecode(p);
  if (decoded === null) return true;
  if (MANAGEMENT_API_EXACT_PATHS.includes(decoded)) return true;
  return under(MANAGEMENT_API_PATHS, decoded);
}
function oldOauthLeaf(p) {
  const decoded = oldDecode(p);
  if (decoded === null) return null;
  const s = decoded.split("/");
  if (s.length !== 6) return null;
  if (s[1] !== "api" || s[2] !== "mcp-gateway" || s[3] !== "oauth") return null;
  if (!s[4] || !s[5]) return null;
  return s[5];
}
function oldClassify(p, method = "GET") {
  if (oldMatchesPrefix(p, "/api/mcp/control")) return "mcp-control";
  if (oldMatchesPrefix(p, "/api/pxpipe")) return "pxpipe";
  if (oldIsPublicApi(p, method)) return "public";
  if (under(ALWAYS_PROTECTED, p)) return "always-protected";
  if (under(LOCAL_ONLY_PATHS, p)) return "local-only";
  if (GATEWAY_SURFACES.includes(p)) return "gateway-key";
  if (oldOauthLeaf(p) === "client-metadata") return "public";
  if (oldOauthLeaf(p) === "callback") return "session";
  if (oldIsManagement(p)) return "management";
  return "session";
}
function oldIsOauthAction(p) {
  const decoded = oldDecode(p);
  return decoded === null || under(OAUTH_ACTION_PREFIXES, decoded);
}
const oldIsModelList = (p) =>
  p === "/api/models" || p === "/api/v1/models" || oldMatchesPrefix(p, "/api/v1/models");
// ---- End of frozen oracle. ----

const apiRoot = path.resolve(import.meta.dirname, "../../src/app/api");
function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(file) : entry.name === "route.js" ? [file] : [];
  });
}
const ROUTES = routeFiles(apiRoot).map((file) =>
  `/api/${path.relative(apiRoot, file).replace(/\\/g, "/").replace(/\/?route\.js$/, "")}`);

const LISTED = [
  ...PUBLIC_API_PATHS, ...PUBLIC_API_EXACT_PATHS, ...PUBLIC_PREFIXES, ...ALWAYS_PROTECTED,
  ...MANAGEMENT_API_PATHS, ...MANAGEMENT_API_EXACT_PATHS, ...LOCAL_ONLY_PATHS, ...OAUTH_ACTION_PREFIXES,
  ...GATEWAY_SURFACES, ...TUNNEL_SESSION_PATHS,
  "/backend-api/codex/alpha/search", "/api/mcp/control", "/api/pxpipe", "/api/models", "/api/v1/models",
  "/api/mcp-gateway/oauth/i1/client-metadata", "/api/mcp-gateway/oauth/i1/callback",
  "/api/mcp-gateway/oauth/i1/authorize", "/api/mcp-gateway/oauth/a/b/callback",
  "/api/mcp-gateway/oauth//callback", "/api/unlisted", "/dashboard", "/", "",
];

// Boundary and encoding spellings that separate exact, segment and decoded matching.
const encodeAt = (p, index) =>
  `${p.slice(0, index)}%${p.charCodeAt(index).toString(16).padStart(2, "0")}${p.slice(index + 1)}`;
function variants(p) {
  const base = p.replace(/\/$/, "");
  const last = base.length - 1;
  const encoded = last > 0 ? [encodeAt(base, last), encodeAt(encodeAt(base, last), last).replace(/%(?=[0-9a-f]{2}$)/, "%25")] : [];
  return [
    p, base, `${base}/`, `${base}/child`, `${base}X`, `${base}-x`, base.slice(0, -1),
    `/prefix${base}`, base.toUpperCase(), `${base}%2Fchild`, `${base}%252Fchild`, `${base}%`,
    `${base}%25`, `${base}/%E0%A4%A`, base.replace("-", "%2D"), base.replace("-", "%252D"),
    base.replace(/\//g, "%2F").replace(/^%2F/, "/"), ...encoded,
  ];
}
const CORPUS = [...new Set([...LISTED, ...ROUTES, ...ROUTES.map((r) => r.replace(/\[[^\]]+\]/g, "id1"))]
  .flatMap(variants))];
const METHODS = [undefined, "", "GET", "get", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"];

function differences(actual, expected, paths = CORPUS) {
  return paths.filter((p) => actual(p) !== expected(p));
}

describe("review x route policy table", () => {
  it("scans a real corpus", () => {
    expect(ROUTES.length).toBeGreaterThan(100);
    for (const route of ROUTES) expect(CORPUS).toContain(route);
  });

  it.each(METHODS)("classifies every path as the old list logic did (method %j)", (method) => {
    expect(differences((p) => classifyRoute(p, method), (p) => oldClassify(p, method))).toEqual([]);
    expect(differences((p) => isInRouteClass(p, "public", method), (p) => oldIsPublicApi(p, method))).toEqual([]);
  });

  it("keeps overlapping gate membership independent of first-match order", () => {
    expect(differences((p) => isInRouteClass(p, "management"), oldIsManagement)).toEqual([]);
    expect(differences((p) => isInRouteClass(p, "local-only"), (p) => under(LOCAL_ONLY_PATHS, p))).toEqual([]);
    expect(differences(isPublicLlmApi, oldIsPublicLlm)).toEqual([]);
    expect(differences((p) => __test__.isManagementApi(p), oldIsManagement)).toEqual([]);
    const path = "/api/oauth/cursor/auto-import";
    expect(classifyRoute(path)).toBe("always-protected");
    expect(isInRouteClass(path, "local-only")).toBe(true);
    expect(isInRouteClass(path, "management")).toBe(true);
  });

  // proxy() branches on the first-match class for these gates.
  it.each([
    ["mcp-control", (p) => oldMatchesPrefix(p, "/api/mcp/control")],
    ["pxpipe", (p) => oldMatchesPrefix(p, "/api/pxpipe")],
    ["always-protected", (p) => under(ALWAYS_PROTECTED, p)],
    ["gateway-key", (p) => GATEWAY_SURFACES.includes(p)],
  ])("first match equals the old %s check", (routeClass, oldCheck) => {
    for (const method of METHODS) {
      expect(differences((p) => classifyRoute(p, method) === routeClass, oldCheck)).toEqual([]);
    }
  });

  it("keeps the OAuth leaves and route traits", () => {
    expect(differences(gatewayOauthLeaf, oldOauthLeaf)).toEqual([]);
    expect(isInRouteClass("/api/mcp-gateway/oauth/i1/client-metadata", "public")).toBe(false);
    expect(differences((p) => hasRouteTrait(p, "oauth-action"), oldIsOauthAction)).toEqual([]);
    expect(differences((p) => hasRouteTrait(p, "model-list"), oldIsModelList)).toEqual([]);
    expect(differences((p) => hasRouteTrait(p, "session-tunnel-control"),
      (p) => TUNNEL_SESSION_PATHS.includes(p))).toEqual([]);
  });

  it("keeps the guard exports and freezes the tables", () => {
    expect(__test__.classifyRoutePolicy).toBe(classifyRoute);
    expect(__test__.isPublicLlmApi).toBe(isPublicLlmApi);
    expect(__test__.matchesPrefix).toBe(matchesPrefix);
    for (const table of [ROUTE_POLICIES, ROUTE_TRAITS]) {
      expect(Object.isFrozen(table)).toBe(true);
      expect(table.every(Object.isFrozen)).toBe(true);
      for (const entry of table) expect(entry.notes).toBeTruthy();
    }
  });

  it("leaves no path list in dashboardGuard.js", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/dashboardGuard.js"), "utf8");
    expect(source).not.toMatch(/\b(?:PUBLIC_API_(?:EXACT_)?PATHS|PUBLIC_PREFIXES|ALWAYS_PROTECTED|MANAGEMENT_API_(?:EXACT_)?PATHS|LOCAL_ONLY_PATHS|OAUTH_ACTION_PREFIXES)\b/);
    // No array literal that starts with a path string, named or inline.
    expect(source).not.toMatch(/\[\s*(?:\/\/[^\n]*\n\s*)*["'`]\//);
  });
});
