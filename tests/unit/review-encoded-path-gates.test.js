import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  next: Symbol("next"),
  validateApiKey: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getSettings: vi.fn(),
  machineId: vi.fn(),
  verifyToken: vi.fn(),
  trusted: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.next),
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
    redirect: vi.fn(),
    rewrite: vi.fn(),
  },
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
  getApiKeyByKey: mocks.getApiKeyByKey,
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.machineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyToken }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: mocks.trusted }));
vi.mock("@/lib/auth/oidc", () => ({ fetchOidcDiscovery: vi.fn(), probeOidcClientSecret: vi.fn(), getPublicOrigin: () => "http://localhost" }));

const { proxy } = await import("../../src/dashboardGuard.js");

function request(path) {
  const url = new URL(`http://localhost${path}`);
  return {
    nextUrl: { pathname: url.pathname, search: url.search, searchParams: url.searchParams, clone() { return { ...this }; } },
    headers: new Headers({
      host: path.includes("antigravity") ? "localhost" : "router.example.com",
      ...(path.includes("antigravity") ? { origin: "http://localhost" } : {}),
    }),
    method: "POST",
    cookies: { get: vi.fn(() => undefined) },
    url: url.href,
  };
}

describe("encoded protected route gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.machineId.mockResolvedValue("cli-token");
    mocks.verifyToken.mockResolvedValue(false);
    mocks.trusted.mockReturnValue(true);
  });

  it.each([
    "/api/cli-tools/antigravity-mitm",
    "/api/cli-tools/%61ntigravity-mitm",
    "/api/cli-tools/antigravity%2Dmitm/alias",
  ])("rejects unauthenticated MITM mutation spelling %s", async (path) => {
    expect(await proxy(request(path))).toMatchObject({ status: 403 });
  });

  it.each([
    ["/api/shutdown", "/api/%73hutdown"],
    ["/api/settings/database", "/api/settings/%64atabase"],
    ["/api/version/shutdown", "/api/version/%73hutdown"],
    ["/api/version/update", "/api/version/%75pdate"],
    ["/api/oauth/cursor/auto-import", "/api/oauth/cursor/%61uto-import"],
    ["/api/oauth/commandcode/auto-import", "/api/oauth/commandcode/%61uto-import"],
    ["/api/oauth/kiro/auto-import", "/api/oauth/kiro/%61uto-import"],
    ["/api/oauth/xiaomi-mimo/auto-import", "/api/oauth/xiaomi-mimo/%61uto-import"],
    ["/api/oauth/antigravity/rotation", "/api/oauth/antigravity/%72otation"],
  ])("gives plain and encoded ALWAYS_PROTECTED paths the same denial", async (plain, encoded) => {
    const plainResponse = await proxy(request(plain));
    const encodedResponse = await proxy(request(encoded));
    expect([401, 403]).toContain(plainResponse.status);
    expect(encodedResponse.status).toBe(plainResponse.status);
  });
});
