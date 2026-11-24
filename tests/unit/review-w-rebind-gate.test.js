import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  hasTrustedPeerHeaders: vi.fn(),
  validateApiKey: vi.fn(),
  getApiKeyByKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
  getApiKeyByKey: mocks.getApiKeyByKey,
  validateGatewayKey: vi.fn(),
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: mocks.hasTrustedPeerHeaders }));
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

function request(pathname, host, origin) {
  return {
    nextUrl: { pathname, search: "", searchParams: new URLSearchParams() },
    headers: new Headers({ host, origin, "x-9r-real-ip": "127.0.0.1" }),
    method: pathname.endsWith("/start") ? "POST" : "GET",
    cookies: { get: () => undefined },
    url: `http://localhost:20128${pathname}`,
  };
}

beforeEach(() => {
  mocks.getSettings.mockResolvedValue({ requireLogin: false, requireApiKey: false });
  mocks.getConsistentMachineId.mockResolvedValue("cli-token");
  mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  mocks.hasTrustedPeerHeaders.mockReturnValue(true);
  mocks.validateApiKey.mockResolvedValue(false);
  mocks.getApiKeyByKey.mockResolvedValue(null);
});

describe("#2461 credential-free loopback routes reject DNS rebinding", () => {
  it.each(["/api/key-groups", "/api/pxpipe/start"])("rejects an attacker-controlled Host and matching Origin on %s", async (path) => {
    const response = await proxy(request(path, "evil.example:20128", "http://evil.example:20128"));
    expect([401, 403]).toContain(response.status);
  });

  it.each(["/api/key-groups", "/api/pxpipe/start"])("allows localhost Host and Origin on %s", async (path) => {
    const response = await proxy(request(path, "localhost:20128", "http://localhost:20128"));
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });
});
