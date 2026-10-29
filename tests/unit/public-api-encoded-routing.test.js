import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex.js";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher.js";
import nextConfig from "../../next.config.mjs";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match.js";

const state = vi.hoisted(() => ({ seen: [], session: null, management: true, response: null }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: true, requireLogin: true }),
  validateApiKey: async (key) => key === "owner-key",
  validateGatewayKey: async () => false,
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "cli-token" }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async (token) => token === "dashboard" }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: () => false }));
vi.mock("../../src/dashboardGuard", async () => {
  const actual = await vi.importActual("../../src/dashboardGuard.js");
  return { ...actual, canAccessManagementApi: async () => state.management, proxy: async (request) => {
    state.seen.push(request);
    const response = state.response || await actual.proxy(request);
    response.headers.set("x-guard-evidence", "preserved");
    response.headers.append("set-cookie", "guard-cookie=kept; Path=/");
    return response;
  } };
});
vi.mock("../../src/lib/mimoLoginSession", () => ({
  SESSION_COOKIE: "dd_mimo_login", sessionFromRequest: () => state.session,
  isAccountProxyPath: () => false, isMimoTakeoverPath: () => false,
  takeoverUpstreamPath: (path) => path, proxyAccountRequest: vi.fn(), runTakeover: vi.fn(),
  attachSessionCookie: (response) => response,
  clearedSessionCookie: () => "dd_mimo_login=; Path=/; Max-Age=0", originOf: () => "http://gateway.test",
}));
vi.mock("../../src/lib/webLoginSession", () => ({
  isolatedOrigin: () => null, requestOrigin: () => "http://gateway.test", isIsolatedLoginRequest: () => false,
  consumeBootstrap: vi.fn(), proxySessionFromRequest: vi.fn(), proxySessionCookie: vi.fn(),
  proxyPathFor: vi.fn(), upstreamUrlFor: vi.fn(), proxyWebLoginRequest: vi.fn(),
}));
const { default: proxy } = await import("../../src/proxy.js");
const encode = (path) => path.replace(/[a-z0-9]/gi, (character) => `%${character.charCodeAt(0).toString(16)}`);
const nativeMatch = getRouteMatcher(getRouteRegex("/api/v1/native/[provider]/[...operation]"));
function request(path, principal = "cli", options = {}) {
  return new NextRequest(`http://gateway.test${path}`, { ...options, headers: {
    host: "gateway.test",
    ...(principal === "cli" ? { "x-9r-cli-token": "cli-token" } : {}),
    ...(principal === "owner" ? { authorization: "Bearer owner-key" } : {}),
    ...(principal === "dashboard" ? { cookie: "auth_token=dashboard" } : {}),
    ...options.headers,
  } });
}
function target(response) {
  return new URL(response.headers.get("x-middleware-rewrite"));
}
beforeEach(() => {
  state.seen = []; state.session = null; state.management = true; state.response = null;
});

describe("post-guard encoded public API dispatch", () => {
  it.each(["cli", "owner"])("routes fully encoded static prefixes for %s through real Next matching", async (principal) => {
    for (const prefix of ["/v1", "/v1/v1", "/api/v1"]) {
      const req = request(encode(`${prefix}/native/openai/files/resource`), principal);
      const response = await proxy(req);
      const url = target(response);
      expect(url.pathname).toBe(`/api/v1/native${encode("/openai/files/resource")}`);
      expect(nativeMatch(url.pathname)).toEqual({ provider: "openai", operation: ["files", "resource"] });
      expect(state.seen.at(-1)).toBe(req);
      expect(state.seen.at(-1).nextUrl.pathname).toBe(encode(`${prefix}/native/openai/files/resource`));
      expect(response.headers.get("x-middleware-next")).toBeNull();
      expect(response.headers.get("x-guard-evidence")).toBe("preserved");
      expect(response.headers.get("set-cookie")).toContain("guard-cookie=kept");
    }
  });

  it.each(["dashboard", "anonymous"])("does not dispatch denied %s", async (principal) => {
    const response = await proxy(request(encode("/v1/native/openai/files/resource"), principal));
    expect(response.status).toBe(401);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("does not mistake an ordinary 200 or redirect for guard continuation", async () => {
    for (const response of [new NextResponse("guard result"), NextResponse.redirect("http://gateway.test/login")]) {
      state.response = response;
      expect(await proxy(request(encode("/v1/chat/completions")))).toBe(response);
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("leaves plain canonical and alias paths to existing Next rewrites", async () => {
    const rewrites = await nextConfig.rewrites();
    for (const path of ["/api/v1/chat/completions", "/v1/chat/completions", "/v1/v1/chat/completions"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      if (!path.startsWith("/api/")) {
        const rule = rewrites.find((row) => getPathMatch(row.source)(path));
        expect(rule.destination).toBe("/api/v1/:path*");
        expect(getPathMatch(rule.source)(path).path).toEqual(["chat", "completions"]);
      }
    }
  });

  it.each([
    ["/v1/chat/completions", "/api/v1/chat/completions"],
    ["/v1/responses/compact", "/api/v1/responses/compact"],
    ["/responses", "/api/v1/responses"],
    ["/codex/responses", "/api/v1/responses"],
    ["/v1beta/models", "/api/v1beta/models"],
  ])("canonicalizes static route %s", async (path, expected) => {
    expect(target(await proxy(request(encode(path)))).pathname).toBe(expected);
  });

  it("preserves raw dynamic suffixes without decoding twice", async () => {
    const suffix = "/%6fpenai/files/id%252Fpart%2541";
    const response = await proxy(request(`${encode("/v1/native")}${suffix}`));
    expect(target(response).pathname).toBe(`/api/v1/native${suffix}`);
    expect(nativeMatch(target(response).pathname)).toEqual({ provider: "openai", operation: ["files", "id%2Fpart%41"] });
    const file = await proxy(request(`${encode("/v1/files")}/id%2541`));
    expect(target(file).pathname).toBe("/api/v1/files/id%2541");
  });

  it.each([
    ["files", "content", "GET"],
    ["batches", "cancel", "POST"],
    ["messages/batches", "cancel", "POST"],
    ["messages/batches", "results", "GET"],
  ])("routes encoded %s/[id]/%s without changing ID bytes", async (route, leaf, method) => {
    const match = getRouteMatcher(getRouteRegex(`/api/v1/${route}/[id]/${leaf}`));
    const query = "?key=one%2Ftwo&key=three+four&blank=&literal=%252F";
    for (const principal of ["cli", "owner"]) {
      for (const prefix of ["/v1", "/v1/v1", "/api/v1"]) {
        for (const id of ["%69%64", "id%252Fpart%2541"]) {
          for (const base of [`${prefix}/${route}`, encode(`${prefix}/${route}`)]) {
            const body = method === "POST" ? '{ "reason": "fixture" }' : undefined;
            const req = request(`${base}/${id}/${encode(leaf)}${query}`, principal, { method, body });
            const url = target(await proxy(req));
            expect(url.pathname).toBe(`/api/v1/${route}/${id}/${leaf}`);
            expect(match(url.pathname)).toEqual({ id: id === "%69%64" ? "id" : "id%2Fpart%41" });
            expect(url.search).toBe(query);
            expect(state.seen.at(-1)).toBe(req);
            expect(req.nextUrl.pathname).toBe(`${base}/${id}/${encode(leaf)}`);
            expect(req.method).toBe(method);
            expect(req.bodyUsed).toBe(false);
            if (body !== undefined) expect(await req.text()).toBe(body);
          }
        }
      }
    }
  });

  it("does not decode unknown, double-encoded or nonterminal leaves or native catch-all tails", async () => {
    for (const [route, suffix] of [
      ["files", "/%69%64/%63ancel"],
      ["files", "/%69%64/%2563ontent"],
      ["files", "/%69%64/%63ontent/extra"],
      ["batches", "/%69%64/%72esults"],
      ["messages/batches", "/%69%64/%63ontent"],
      ["messages/batches", "/%69%64/%72esults/extra"],
      ["native", "/%6fpenai/files/%69%64/%63ontent"],
      ["native", "/%6fpenai/batches/%69%64/%63ancel"],
      ["native", "/%61nthropic/messages/batches/%69%64/%72esults"],
    ]) {
      const response = await proxy(request(`${encode(`/v1/${route}`)}${suffix}`));
      expect(target(response).pathname).toBe(`/api/v1/${route}${suffix}`);
    }
  });

  it.each(["dashboard", "anonymous"])("denies encoded static leaves before rewriting for %s", async (principal) => {
    for (const route of ["files/id/content", "batches/id/cancel", "messages/batches/id/cancel", "messages/batches/id/results"]) {
      const response = await proxy(request(encode(`/v1/${route}`), principal));
      expect(response.status).toBe(401);
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("never expands unknown or double-encoded static prefixes into routes", async () => {
    for (const path of ["/%2576%2531/native/openai/files", "/v1/%256eative/openai/files", "/api/%256beys", "/api/keys/%72eveal"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("rejects malformed or separator-expanded candidates without continuation", async () => {
    for (const suffix of ["/%GG", "/%2Fapi", "/%5capi"]) {
      const response = await proxy(request(`${encode("/v1/native")}${suffix}`));
      expect([400, 401]).toContain(response.status);
      expect(response.headers.get("x-middleware-next")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
    // Preserve a raw proxy pathname: URL constructors otherwise remove dot segments.
    const req = request("/v1/native/openai/files");
    Object.defineProperty(req, "nextUrl", { value: { pathname: `${encode("/v1/native")}/%2e%2e/keys`, searchParams: new URLSearchParams() } });
    const response = await proxy(req);
    expect(response.status).toBe(400);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("preserves query bytes, POST method and unread body", async () => {
    const query = "?key=one%2Ftwo&key=three+four&blank=&literal=%252F";
    const body = '{ "model": "fixture", "messages": [] }';
    const req = request(`${encode("/v1/chat/completions")}${query}`, "cli", {
      method: "POST", body, headers: { "content-type": "application/json", "x-fixture": "retained" },
    });
    const response = await proxy(req);
    expect(target(response).search).toBe(query);
    expect(req.method).toBe("POST");
    expect(req.headers.get("x-fixture")).toBe("retained");
    expect(req.bodyUsed).toBe(false);
    expect(await req.text()).toBe(body);
    expect(getRouteMatcher(getRouteRegex("/api/v1/chat/completions"))(target(response).pathname)).toEqual({});
  });

  it.each(["invalid", "valid"])("handles %s MiMo session caller without losing guard cookies", async (kind) => {
    state.session = kind === "valid" ? { upstreamBase: "https://unused.invalid" } : null;
    const req = request(encode("/v1/chat/completions"), "cli", { headers: { cookie: "dd_mimo_login=fixture" } });
    const response = await proxy(req);
    expect(target(response).pathname).toBe("/api/v1/chat/completions");
    expect(state.seen).toEqual([req]);
    expect(response.headers.get("set-cookie")).toContain("guard-cookie=kept");
    if (kind === "invalid") expect(response.headers.get("set-cookie")).toContain("dd_mimo_login=;");
  });
});
