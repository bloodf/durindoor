// #2174 DNS rebinding on loopback gates; #2175 TRUST_PROXY has no effect on the limiter.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  hasTrustedPeerHeaders: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, validateApiKey: mocks.validateApiKey }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: mocks.hasTrustedPeerHeaders }));
vi.mock("@/mitm/controlProof", () => ({
  CONTROL_PORT_HEADER: "x-9r-owner-port",
  CONTROL_PROOF_HEADER: "x-9r-owner-proof",
  verifyControlProof: vi.fn(),
}));

const { proxy, canAccessManagementApi } = await import("../../src/dashboardGuard.js");
const { getClientIp, resetLoginLimiter } = await import("../../src/lib/auth/loginLimiter.js");
const PEER_TOKEN = "peer-token-fixture";

function request(pathname, headers = {}) {
  return {
    method: "GET",
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers({ "x-9r-peer-token": PEER_TOKEN, "x-9r-real-ip": "127.0.0.1", ...headers }),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
  resetLoginLimiter();
  mocks.getSettings.mockResolvedValue({ requireLogin: false, requireApiKey: false });
  mocks.validateApiKey.mockResolvedValue(false);
  mocks.getConsistentMachineId.mockResolvedValue("cli-token");
  mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  mocks.hasTrustedPeerHeaders.mockImplementation((r) => r.headers.get("x-9r-peer-token") === PEER_TOKEN);
});

afterEach(() => {
  delete process.env.NINEROUTER_PEER_TOKEN;
  delete process.env.TRUST_PROXY;
});

describe("#2174 management API loopback gate vs DNS rebinding", () => {
  it("rejects Host evil.example with Origin evil.example", async () => {
    const r = request("/api/settings", { host: "evil.example:20128", origin: "http://evil.example:20128" });
    expect(await canAccessManagementApi(r)).toBe(false);
  });

  it("rejects Host evil.example with no Origin", async () => {
    expect(await canAccessManagementApi(request("/api/settings", { host: "evil.example:20128" }))).toBe(false);
  });

  it("allows loopback Host with no Origin (curl/CLI)", async () => {
    expect(await canAccessManagementApi(request("/api/settings", { host: "127.0.0.1:20128" }))).toBe(true);
  });

  it("allows Host localhost with Origin http://localhost:20128", async () => {
    const r = request("/api/settings", { host: "localhost:20128", origin: "http://localhost:20128" });
    expect(await canAccessManagementApi(r)).toBe(true);
  });
});

describe("#2174 /api/mcp/control gate vs DNS rebinding", () => {
  it("rejects Host evil.example with Origin evil.example", async () => {
    const res = await proxy(request("/api/mcp/control", { host: "evil.example:20128", origin: "http://evil.example:20128" }));
    expect(res.status).toBe(401);
  });

  it("allows Host 127.0.0.1:20128 with no Origin", async () => {
    const res = await proxy(request("/api/mcp/control", { host: "127.0.0.1:20128" }));
    expect(res).toBe(mocks.nextResponse);
  });

  it("allows Host localhost with Origin http://localhost:20128", async () => {
    const res = await proxy(request("/api/mcp/control", { host: "localhost:20128", origin: "http://localhost:20128" }));
    expect(res).toBe(mocks.nextResponse);
  });
});

describe("#2175 TRUST_PROXY", () => {
  it("does not change login limiter client IP resolution", () => {
    const r = request("/api/auth/login", { host: "localhost:20128", "x-forwarded-for": "9.9.9.9" });
    r.headers.delete("x-9r-real-ip");
    const before = getClientIp(r);
    process.env.TRUST_PROXY = "true";
    expect(getClientIp(r)).toBe(before);
    expect(before).toBe("unknown");
  });
});
