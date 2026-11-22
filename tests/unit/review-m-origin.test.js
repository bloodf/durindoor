/**
 * #2243 Origin gate bypass, #2269 /v1 credential-free foreign Origin,
 * #2285 proxy.js static route list drift.
 *
 * Real: src/proxy.js, src/dashboardGuard.js, Next request/route matching.
 * Synthetic: settings, API-key validation, dashboard JWT, trusted-peer proof.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex.js";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher.js";

const state = vi.hoisted(() => ({ requireApiKey: false }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: state.requireApiKey, requireLogin: true }),
  validateApiKey: async (key) => key === "any-key",
  getApiKeyByKey: async (key) => (key === "any-key" ? { id: "k1", isAdmin: false } : null),
  validateGatewayKey: async () => false,
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "cli-token" }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async (token) => token === "dashboard" }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: () => true }));
vi.mock("../../src/lib/mimoLoginSession", () => ({
  SESSION_COOKIE: "dd_mimo_login", sessionFromRequest: () => null,
  isAccountProxyPath: () => false, isMimoTakeoverPath: () => false,
  takeoverUpstreamPath: (p) => p, proxyAccountRequest: vi.fn(), runTakeover: vi.fn(),
  attachSessionCookie: (response) => response,
  clearedSessionCookie: () => "dd_mimo_login=; Path=/; Max-Age=0", originOf: () => "http://localhost:20128",
}));
vi.mock("../../src/lib/webLoginSession", () => ({
  isolatedOrigin: () => null, requestOrigin: () => "http://localhost:20128", isIsolatedLoginRequest: () => false,
  consumeBootstrap: vi.fn(), proxySessionFromRequest: vi.fn(), proxySessionCookie: vi.fn(),
  proxyPathFor: vi.fn(), upstreamUrlFor: vi.fn(), proxyWebLoginRequest: vi.fn(),
}));

const { default: proxy } = await import("../../src/proxy.js");

const FOREIGN = "https://evil.example";
const local = { host: "localhost:20128", "x-9r-real-ip": "127.0.0.1" };
function req(pathname, { headers = {}, method = "GET", search = "" } = {}) {
  return new NextRequest(`http://localhost:20128${pathname}${search}`, { method, headers: { ...local, ...headers } });
}
const passes = (response) => response.headers.get("x-middleware-next") === "1" || Boolean(response.headers.get("x-middleware-rewrite"));
const encode = (p) => p.replace(/[a-z0-9]/gi, (c) => `%${c.charCodeAt(0).toString(16)}`);

beforeEach(() => {
  state.requireApiKey = false;
});

describe("#2243 /api/version children get the Origin gate", () => {
  it("keeps exact GET /api/version public, even with a foreign Origin", async () => {
    expect(passes(await proxy(req("/api/version", { headers: { origin: FOREIGN } })))).toBe(true);
  });

  it("does not treat non-GET /api/version as public", async () => {
    const response = await proxy(req("/api/version", { method: "POST", headers: { origin: FOREIGN } }));
    expect(response.status).toBe(403);
  });

  it.each(["/api/version/update", "/api/version/shutdown"])(
    "rejects a foreign-Origin cookie POST to %s with 403",
    async (p) => {
      const response = await proxy(req(p, { method: "POST", headers: { origin: FOREIGN, cookie: "auth_token=dashboard" } }));
      expect(response.status).toBe(403);
    },
  );

  it("still accepts the same-origin dashboard cookie on a version child", async () => {
    const response = await proxy(req("/api/version/update", {
      method: "POST", headers: { origin: "http://localhost:20128", cookie: "auth_token=dashboard" },
    }));
    expect(passes(response)).toBe(true);
  });
});

describe("#2243 a throwaway ?key= no longer lifts the Origin block for cookie routes", () => {
  it.each([
    ["/api/data-retention", "GET"], ["/api/key-groups", "GET"], ["/api/shutdown", "POST"],
  ])("rejects foreign Origin + operator cookie + any key on %s", async (p, method) => {
    const response = await proxy(req(p, {
      method, search: "?key=any-key", headers: { origin: FOREIGN, cookie: "auth_token=dashboard" },
    }));
    expect(response.status).toBe(403);
  });

  it("keeps a cookie-less foreign-Origin API-key caller (key alone authorizes) unblocked at the Origin gate", async () => {
    const response = await proxy(req("/api/key-groups", { headers: { origin: FOREIGN, authorization: "Bearer any-key" } }));
    expect(response.status).not.toBe(403);
  });

  it("lets a management route be authorized by the key alone even when a stale cookie rides along", async () => {
    const response = await proxy(req("/api/usage/me", {
      headers: { origin: FOREIGN, authorization: "Bearer any-key", cookie: "auth_token=stale" },
    }));
    expect(passes(response)).toBe(true);
  });
});

describe("#2269 /v1 rejects credential-free loopback callers with a foreign Origin", () => {
  it.each([
    ["/v1/files", "GET"], ["/api/v1/files", "GET"], ["/v1/chat/completions", "POST"],
  ])("403 for %s %s", async (p, method) => {
    const response = await proxy(req(p, { method, headers: { origin: FOREIGN } }));
    expect(response.status).toBe(403);
  });

  it("rejects an unparsable Origin as non-loopback", async () => {
    const response = await proxy(req("/v1/files", { headers: { origin: "not-an-origin" } }));
    expect(response.status).toBe(403);
  });

  it("keeps credential-free loopback callers with no Origin or the same Origin", async () => {
    expect(passes(await proxy(req("/v1/files")))).toBe(true);
    expect(passes(await proxy(req("/v1/files", { headers: { origin: "http://localhost:20128" } })))).toBe(true);
  });

  it.each([
    "https://localhost:20128",
    "http://localhost:20129",
    "http://127.0.0.1:9",
  ])("keeps a loopback Origin with another port or scheme (%s)", async (origin) => {
    expect(passes(await proxy(req("/v1/files", { headers: { origin } })))).toBe(true);
  });

  it("keeps explicit API-key and CLI-token callers with a foreign Origin (CORS)", async () => {
    expect(passes(await proxy(req("/v1/files", { headers: { origin: FOREIGN, authorization: "Bearer any-key" } })))).toBe(true);
    expect(passes(await proxy(req("/v1/files", { headers: { origin: FOREIGN, "x-9r-cli-token": "cli-token" } })))).toBe(true);
  });

  it("still answers browser preflights so API-key apps keep CORS", async () => {
    const response = await proxy(req("/v1/chat/completions", { method: "OPTIONS", headers: { origin: FOREIGN } }));
    expect(response.status).toBe(204);
  });
});

describe("#2285 proxy.js static route list matches the route tree", () => {
  const root = path.resolve(import.meta.dirname, "../../src");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name === "route.js" ? [full] : [];
  });
  const staticPrefixes = (base) => [...new Set(walk(path.join(root, base)).map((file) => {
    const segments = path.relative(path.join(root, base), path.dirname(file)).split(path.sep).filter(Boolean);
    const end = segments.findIndex((segment) => segment.startsWith("["));
    return (end === -1 ? segments : segments.slice(0, end)).join("/");
  }).filter(Boolean))];
  const source = fs.readFileSync(path.join(root, "proxy.js"), "utf8");
  const listed = (name) => {
    const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]\\.map|const ${name} = (\\[\\[[\\s\\S]*?\\]\\]);`).exec(source);
    return new Set([...(match[1] ?? match[2]).matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  };

  it("lists every static /api/v1 route prefix", () => {
    const entries = listed("API_STATIC_PATHS");
    const missing = staticPrefixes("app/api/v1").filter((prefix) => !entries.has(prefix));
    expect(missing).toEqual([]);
  });

  it("lists every static /api/v1beta route prefix", () => {
    const entries = listed("V1BETA_STATIC_PATHS");
    expect(staticPrefixes("app/api/v1beta").filter((prefix) => !entries.has(prefix))).toEqual([]);
  });

  it.each([
    ["/v1/alpha/search", "/api/v1/alpha/search"],
    ["/v1/me/sessions", "/api/v1/me/sessions"],
    ["/v1/session-captures/abc", "/api/v1/session-captures/abc"],
  ])("normalizes the encoded spelling of %s", async (plain, canonical) => {
    const [head, ...rest] = plain.split("/").filter(Boolean);
    const encoded = `/${head}/${rest.map((part, i) => (part === "abc" ? part : encode(part))).join("/")}`;
    const response = await proxy(req(encoded, { headers: { "x-9r-cli-token": "cli-token" } }));
    expect(new URL(response.headers.get("x-middleware-rewrite")).pathname).toBe(canonical);
  });

  it("normalizes encoded v1beta/interactions and backend-api/codex/alpha/search", async () => {
    const cli = { headers: { "x-9r-cli-token": "cli-token" } };
    const beta = await proxy(req(encode("/v1beta/interactions"), cli));
    expect(new URL(beta.headers.get("x-middleware-rewrite")).pathname).toBe("/api/v1beta/interactions");
    const backend = await proxy(req(encode("/backend-api/codex/alpha/search"), cli));
    const url = new URL(backend.headers.get("x-middleware-rewrite"));
    expect(url.pathname).toBe("/backend-api/codex/alpha/search");
    expect(getRouteMatcher(getRouteRegex("/backend-api/codex/alpha/search"))(url.pathname)).toEqual({});
  });
});
