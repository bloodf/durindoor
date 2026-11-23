import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRouter } from "../../website/src/mock/router.js";
import { registerAll } from "../../website/src/mock/handlers/index.js";
import { store } from "../../website/src/mock/store.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

// These real endpoints are deliberately unavailable in the public demo.
const unsupported = new Set([
  // Authentication enrollment and external callbacks are unavailable in the demo.
  "/api/auth/mfa/disable", "/api/auth/mfa/enable", "/api/auth/mfa/setup", "/api/auth/mfa/verify", "/api/auth/oidc/callback",
  // These advanced management operations have no demo implementation yet.
  "/api/combos/:param/restore", "/api/combos/:param/stale-steps", "/api/deployment-mode",
  "/api/mcp-gateway/oauth/:param/:param", "/api/media-providers/routes", "/api/media-providers/tts/elevenlabs/models",
  "/api/models/auto-sync", "/api/models/discovered", "/api/models/test-results",
  "/api/oauth/xiaomi-mimo/login/start", "/api/oauth/xiaomi-mimo/login/status",
  "/api/providers/:param/quota-threshold", "/api/providers/:param/refresh-profile", "/api/providers/:param/refresh-token",
  "/api/providers/cookie-import/pairing", "/api/providers/openrouter/routing", "/api/settings/quota-provider-order",
  "/api/timeline/:param/meta", "/api/usage/:param/claude-reset",
  // Catch-all gateway routes are not dashboard mock endpoints.
  "/api/:param", "/api/v1/:param",
]);

function routePattern(file) {
  return "/api/" + relative(resolve(root, "src/app/api"), dirname(file)).split("/").map((part) => part.startsWith("[") ? ":param" : part).join("/");
}
function sample(pattern) { return pattern.replace(/:[^/]+/g, "demo-id"); }
function matches(pattern, path) {
  const parts = pattern.split("/");
  const actual = path.split("/");
  return parts.length === actual.length && parts.every((part, i) => part.startsWith(":") || part === actual[i]);
}

describe("website demo contract", () => {
  it("covers API route literals used by dashboard UI", () => {
    const routes = files(resolve(root, "src/app/api")).filter((file) => file.endsWith("/route.js")).map(routePattern);
    const uiFiles = ["src/app/(dashboard)", "src/shared"].flatMap((dir) => files(resolve(root, dir))).filter((file) => /\.[jt]sx?$/.test(file) && !/\.(stories|test)\./.test(file));
    const called = new Set();
    for (const file of uiFiles) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/[`"'](\/api\/[^`"'\s]*)[`"']/g)) {
        const path = match[1].split("?")[0].replace(/\$\{[^}]+\}/g, "demo-id");
        for (const route of routes) if (matches(route, path)) called.add(route);
      }
    }
    const router = createRouter();
    registerAll(router, { store, external: () => {} });
    const missing = [...called].filter((route) => !unsupported.has(route) && !["GET", "POST", "PUT", "PATCH", "DELETE"].some((method) => router.match(method, sample(route))));
    expect(missing.sort()).toEqual([]);
    expect(called.size).toBeGreaterThan(0);
  });

  it("serves and updates the new demo fixtures", () => {
    const router = createRouter();
    registerAll(router, { store, external: () => {} });
    const call = (method, path, body, query = {}) => {
      const hit = router.match(method, path);
      expect(hit).not.toBeNull();
      return hit.route.handler({ params: hit.params, body, query });
    };
    expect(call("GET", "/api/combos/presets", undefined, { source: "cursor" }).items.length).toBeGreaterThan(0);
    expect(call("GET", "/api/key-groups").groups).toEqual([]);
    expect(call("PUT", "/api/models/enabled", { providerAlias: "demo", ids: ["model"] }).ids).toEqual(["model"]);
    expect(call("GET", "/api/models/enabled", undefined, { providerAlias: "demo" }).ids).toEqual(["model"]);
    const key = call("GET", "/api/keys").keys[0];
    expect(call("GET", "/api/keys/usage").usage[key.id].limits).toEqual([]);
    expect(call("POST", `/api/keys/${key.id}/rotate`).body.key).toBeTruthy();
    expect(call("GET", "/api/providers/openai/readiness").authentication.status).toBe("UNKNOWN");
  });

  it("provides pages for sidebar hrefs", () => {
    const source = readFileSync(resolve(root, "src/shared/components/SidebarNavIcons.js"), "utf8");
    const hrefs = [...source.matchAll(/href:\s*["'](\/dashboard(?:\/[^"']*)?)["']/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((href) => !existsSync(resolve(root, `website/src/app${href}/page.js`)))).toEqual([]);
  });
});
