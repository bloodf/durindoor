import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { originAbsentOrSame } from "../../src/lib/auth/requestOrigin.js";
import { __test__, matchesPrefix, originPresentAndSame } from "../../src/dashboardGuard.js";
import { requireSameOrigin } from "../../src/lib/auth/requireSameOrigin.js";

const apiRoot = path.resolve("../src/app/api");
function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(file) : entry.name === "route.js" ? [file] : [];
  });
}

describe("review r origin helpers", () => {
  it("keeps the two missing-Origin contracts explicit", () => {
    const absent = new Request("http://router.test", { headers: { host: "router.test" } });
    const same = new Request("http://router.test", { headers: { host: "router.test", origin: "https://router.test" } });
    expect(originAbsentOrSame(absent)).toBe(true);
    expect(originPresentAndSame(absent)).toBe(false);
    expect(originPresentAndSame(same)).toBe(true);
    expect(__test__.originPresentAndSame).toBe(originPresentAndSame);
  });

  it("matches route prefixes only at path segment boundaries", () => {
    expect(matchesPrefix("/api/shutdown", "/api/shutdown")).toBe(true);
    expect(matchesPrefix("/api/shutdown/child", "/api/shutdown")).toBe(true);
    expect(matchesPrefix("/api/shutdownX", "/api/shutdown")).toBe(false);
    expect(__test__.classifyRoutePolicy("/api/shutdown")).toBe("always-protected");
    expect(__test__.classifyRoutePolicy("/api/shutdownX")).not.toBe("always-protected");
  });

  it("shares the foreign-Origin response while preserving absent-Origin callers", async () => {
    const absent = new Request("http://router.test", { headers: { host: "router.test" } });
    const foreign = new Request("http://router.test", { headers: { host: "router.test", origin: "https://attacker.test" } });
    expect(await requireSameOrigin(absent)).toBeNull();
    const denied = await requireSameOrigin(foreign);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Cross-origin request denied" });
  });

  it("enumerates every API route and records the default session policy", () => {
    const routes = routeFiles(apiRoot).map((file) => `/api/${path.relative(apiRoot, file).replace(/\/route\.js$/, "").replace(/\\/g, "/")}`);
    expect(routes.length).toBeGreaterThan(0);
    const policies = new Set(["public", "always-protected", "local-only", "management", "session", "mcp-control", "pxpipe", "gateway-key"]);
    const classifications = new Map(routes.map((route) => [route, __test__.classifyRoutePolicy(route)]));
    for (const policy of classifications.values()) expect(policies.has(policy)).toBe(true);
    // Routes that reach proxy's final session gate are explicit so a new route
    // cannot silently inherit a policy by omission.
    const defaultSessionRoutes = [
      "/api/[...catchAll]",
      "/api/auth/mfa/disable",
      "/api/auth/mfa/enable",
      "/api/auth/mfa/setup",
      "/api/compression/preview",
      "/api/data-retention",
      "/api/key-groups",
      "/api/key-groups/[id]",
      "/api/logs/export",
      "/api/token-saver/stream",
    ];
    expect(defaultSessionRoutes).toContain("/api/key-groups");
    expect([...classifications].filter(([, policy]) => policy === "session").map(([route]) => route).sort())
      .toEqual(defaultSessionRoutes);
  });
});
