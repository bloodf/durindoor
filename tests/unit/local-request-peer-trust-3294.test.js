// GHSA-pjm4-8fpg-f9p6: client-supplied peer headers must never confer local access.
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

const { proxy } = await import("../../src/dashboardGuard.js");
const { checkLock, getClientIp, recordFail, resetLoginLimiter } = await import("../../src/lib/auth/loginLimiter.js");
const PEER_TOKEN = "peer-token-fixture";
const originalNodeEnv = process.env.NODE_ENV;

function request(pathname, headers = {}) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers(headers),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("peer header trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    resetLoginLimiter();
    process.env.NODE_ENV = "production";
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.hasTrustedPeerHeaders.mockImplementation((request) =>
      request.headers.get("x-9r-peer-token") === PEER_TOKEN,
    );
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.NINEROUTER_PEER_TOKEN;
    delete process.env.TRUST_PROXY;
  });

  it("rejects spoofed loopback headers without wrapper proof", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "172.18.192.1:20140",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects forged headers from raw development server", async () => {
    process.env.NODE_ENV = "development";
    const response = await proxy(request("/api/v1/models", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": "forged-token",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it.each([
    ["https://localhost:20128", "http://localhost:20128"],
    ["http://localhost:20129", "http://localhost:20128"],
    ["http://localhost:20128", "http://localhost:20128.evil.example"],
  ])("accepts trusted peer regardless of browser origin %s on host %s", async (origin, host) => {
    const response = await proxy(request("/api/v1/models", {
      host,
      origin,
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": PEER_TOKEN,
    }));

    expect(response).toBe(mocks.nextResponse);
  });
  it("accepts a trusted loopback peer without an origin", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": PEER_TOKEN,
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it.each(["::ffff:127.0.0.1", "::1", "[::1]", "127.0.0.1", "::FFFF:127.0.0.1"])(
    "accepts trusted loopback peer %s",
    async (peerIp) => {
      const response = await proxy(request("/api/v1/models", {
        host: "localhost:20128",
        origin: "http://localhost:20128",
        "x-9r-real-ip": peerIp,
        "x-9r-peer-token": PEER_TOKEN,
      }));
      expect(response).toBe(mocks.nextResponse);
    },
  );

  it("rejects a wrapper-stamped proxied loopback client", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": PEER_TOKEN,
      "x-9r-via-proxy": "1",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("keeps unproved login attempts in one bucket", () => {
    expect(getClientIp(request("/api/auth/login", { "x-9r-real-ip": "1.1.1.1" }))).toBe("unknown");
    expect(getClientIp(request("/api/auth/login", {
      "x-9r-real-ip": "203.0.113.9",
      "x-9r-peer-token": PEER_TOKEN,
    }))).toBe("203.0.113.9");
  });

  it("keeps rotating spoofed XFF values in one limiter bucket", () => {
    process.env.TRUST_PROXY = "true";

    for (const spoofedIp of ["198.51.100.10", "198.51.100.11", "198.51.100.12", "198.51.100.13", "198.51.100.14"]) {
      const ip = getClientIp(request("/api/auth/login", { "x-forwarded-for": spoofedIp }));
      expect(ip).toBe("unknown");
      recordFail(ip);
    }

    expect(checkLock("unknown").locked).toBe(true);
  });

  it("accepts XFF from a wrapper-proved trusted proxy", () => {
    process.env.TRUST_PROXY = "true";

    expect(getClientIp(request("/api/auth/login", {
      "x-forwarded-for": "198.51.100.10, 203.0.113.5",
      "x-9r-peer-token": PEER_TOKEN,
    }))).toBe("198.51.100.10");
  });

  it("keeps wrapper-stamped loopback IP precedence over XFF", () => {
    process.env.TRUST_PROXY = "true";

    expect(getClientIp(request("/api/auth/login", {
      "x-9r-real-ip": "127.0.0.1",
      "x-forwarded-for": "198.51.100.10",
      "x-9r-peer-token": PEER_TOKEN,
    }))).toBe("127.0.0.1");
  });
});
