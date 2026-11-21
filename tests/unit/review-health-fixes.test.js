// #2192: /api/health exact-only, /api/health/providers behind management gate.
// #2193: /api/livez & /api/readyz docs + SSRF guard on proxy-pool relay URLs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
    json: async () => body,
  })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  hasTrustedPeerHeaders: vi.fn(),
  createProxyPool: vi.fn(),
  getProxyPools: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProxyPool: vi.fn(),
  deleteProxyPool: vi.fn(),
  getProviderConnections: vi.fn(),
  undiciFetch: vi.fn(),
  testProxyUrl: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
  getApiKeyByKey: mocks.getApiKeyByKey,
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: mocks.hasTrustedPeerHeaders }));
vi.mock("@/mitm/controlProof", () => ({
  CONTROL_PORT_HEADER: "x-9r-owner-port",
  CONTROL_PROOF_HEADER: "x-9r-owner-proof",
  verifyControlProof: vi.fn(),
}));
vi.mock("@/models", () => ({
  createProxyPool: mocks.createProxyPool,
  getProxyPools: mocks.getProxyPools,
  getProxyPoolById: mocks.getProxyPoolById,
  updateProxyPool: mocks.updateProxyPool,
  deleteProxyPool: mocks.deleteProxyPool,
  getProviderConnections: mocks.getProviderConnections,
}));
vi.mock("undici", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    fetch: (...args) => mocks.undiciFetch(...args),
  };
});
vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");
const proxyPoolsRoute = await import("../../src/app/api/proxy-pools/route.js");
const proxyPoolDetailRoute = await import("../../src/app/api/proxy-pools/[id]/route.js");
const proxyPoolTestRoute = await import("../../src/app/api/proxy-pools/[id]/test/route.js");

function makeGuardRequest(pathname, headers = {}, method = "GET", cookieToken = null) {
  const url = new URL(`http://localhost${pathname}`);
  return {
    method,
    nextUrl: {
      pathname: url.pathname,
      search: url.search,
      searchParams: url.searchParams,
    },
    headers: new Headers(headers),
    cookies: {
      get: vi.fn((name) => (name === "auth_token" && cookieToken ? { value: cookieToken } : undefined)),
    },
    url: `http://localhost${pathname}`,
  };
}

function makeJsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: false });
  mocks.validateApiKey.mockResolvedValue(false);
  mocks.getApiKeyByKey.mockResolvedValue(null);
  mocks.getConsistentMachineId.mockResolvedValue("cli-token");
  mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  mocks.hasTrustedPeerHeaders.mockReturnValue(true);
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.getProxyPools.mockResolvedValue([]);
  mocks.createProxyPool.mockImplementation(async (input) => ({ id: "pool-1", ...input }));
  mocks.updateProxyPool.mockImplementation(async (id, patch) => ({ id, ...patch }));
  mocks.testProxyUrl.mockResolvedValue({ ok: true, status: 200, statusText: "OK", elapsedMs: 10 });
});

describe("#2192 /api/health exact-only and /api/health/providers management gate", () => {
  it("keeps exact /api/health public for unauthenticated remote callers", async () => {
    for (const method of ["GET", "OPTIONS"]) {
      const res = await proxy(makeGuardRequest("/api/health", { host: "router.example.com" }, method));
      expect(res, method).toBe(mocks.nextResponse);
    }
  });

  it("does not treat nested /api/health/* paths as public", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    for (const p of ["/api/health/providers", "/api/health/%70roviders", "/api/health/extra"]) {
      const res = await proxy(makeGuardRequest(p, { host: "router.example.com" }, "GET"));
      expect(res.status, p).toBe(401);
    }
  });

  it("places /api/health/providers on the management gate", async () => {
    expect(__test__.isManagementApi("/api/health/providers")).toBe(true);
    expect(__test__.isManagementApi("/api/health")).toBe(false);

    // Unauthenticated remote GET and DELETE are rejected.
    expect((await proxy(makeGuardRequest("/api/health/providers", { host: "router.example.com" }, "GET"))).status).toBe(401);
    expect((await proxy(makeGuardRequest("/api/health/providers", { host: "router.example.com" }, "DELETE"))).status).toBe(401);

    // Non-admin API key can read (GET), but cannot invalidate cache (DELETE -> 403).
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.getApiKeyByKey.mockResolvedValue({ id: "k1", isAdmin: false });
    const keyHeaders = { host: "router.example.com", authorization: "Bearer sk-user" };
    expect(await proxy(makeGuardRequest("/api/health/providers?force=1", keyHeaders, "GET"))).toBe(mocks.nextResponse);
    expect((await proxy(makeGuardRequest("/api/health/providers", keyHeaders, "DELETE"))).status).toBe(403);

    // Admin-scoped API key can DELETE.
    mocks.getApiKeyByKey.mockResolvedValue({ id: "k-admin", isAdmin: true });
    expect(await proxy(makeGuardRequest("/api/health/providers", keyHeaders, "DELETE"))).toBe(mocks.nextResponse);
  });

  it("allows session, CLI, and open-dashboard loopback while blocking foreign-Origin cookies and DNS rebinding", async () => {
    // CLI token passes.
    expect(await proxy(makeGuardRequest("/api/health/providers", {
      host: "router.example.com",
      "x-9r-cli-token": "cli-token",
    }, "DELETE"))).toBe(mocks.nextResponse);

    // Same-origin dashboard session passes; foreign-origin cookie is denied.
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    expect(await proxy(makeGuardRequest("/api/health/providers", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }, "DELETE", "valid-jwt"))).toBe(mocks.nextResponse);
    expect((await proxy(makeGuardRequest("/api/health/providers", {
      host: "localhost:20128",
      origin: "https://evil.example",
    }, "GET", "valid-jwt"))).status).toBe(403);

    // Open-dashboard loopback requires loopback Host (DNS-rebinding safe).
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    expect(await proxy(makeGuardRequest("/api/health/providers", {
      host: "127.0.0.1:20128",
      "x-9r-real-ip": "127.0.0.1",
    }, "GET"))).toBe(mocks.nextResponse);
    expect((await proxy(makeGuardRequest("/api/health/providers", {
      host: "evil.example:20128",
      "x-9r-real-ip": "127.0.0.1",
    }, "GET"))).status).toBe(401);
  });
});

describe("#2193 management API docs for Health routes", () => {
  it("documents /api/livez, /api/readyz, /api/health as none and /api/health/providers as management", () => {
    const docPath = path.resolve(import.meta.dirname, "../../docs/reference/management-api.mdx");
    const content = readFileSync(docPath, "utf8");

    const rowFor = (route) => {
      const line = content.split("\n").find((l) => l.includes(`\`${route}\``));
      expect(line, `missing row for ${route}`).toBeTruthy();
      return line.split("|").map((cell) => cell.trim()).filter(Boolean);
    };

    const livez = rowFor("/api/livez");
    expect(livez[3]).toBe("none");
    expect(livez[2]).not.toMatch(/generic dashboard gate/i);

    const readyz = rowFor("/api/readyz");
    expect(readyz[3]).toBe("none");
    expect(readyz[2]).not.toMatch(/generic dashboard gate/i);

    const health = rowFor("/api/health");
    expect(health[3]).toBe("none");

    const providers = rowFor("/api/health/providers");
    expect(providers[3]).toBe("session, CLI, key, loop");
  });
});

describe("#2193 proxy-pool relay URL SSRF guard", () => {
  const blockedUrls = [
    "http://127.0.0.1:20128/api/settings",
    "https://127.0.0.1/relay",
    "http://localhost:20128/api/keys",
    "http://169.254.169.254/latest/meta-data/",
    "https://169.254.169.254/latest/meta-data/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://10.0.0.5/relay",
    "https://192.168.1.10/relay",
    "https://[::1]/relay",
    "https://user:pass@my-relay.vercel.app/api/relay",
    "http://my-relay.vercel.app/api/relay",
    "file:///etc/passwd",
    "not a url",
  ];

  it.each(blockedUrls)("POST /api/proxy-pools rejects blocked relay URL %s", async (proxyUrl) => {
    for (const type of ["vercel", "cloudflare"]) {
      const res = await proxyPoolsRoute.POST(
        makeJsonRequest("http://localhost:20128/api/proxy-pools", "POST", {
          name: "Bad Relay",
          type,
          proxyUrl,
        })
      );
      expect(res.status, `${type} ${proxyUrl}`).toBe(400);
      expect(res.body.error).toBeTruthy();
      expect(mocks.createProxyPool).not.toHaveBeenCalled();
    }
  });

  it("POST /api/proxy-pools allows public HTTPS relay URLs and keeps http proxy pools flexible", async () => {
    const relayRes = await proxyPoolsRoute.POST(
      makeJsonRequest("http://localhost:20128/api/proxy-pools", "POST", {
        name: "Vercel Relay",
        type: "vercel",
        proxyUrl: "https://my-relay.vercel.app/api/relay",
      })
    );
    expect(relayRes.status).toBe(201);
    expect(mocks.createProxyPool).toHaveBeenCalledWith(expect.objectContaining({
      type: "vercel",
      proxyUrl: "https://my-relay.vercel.app/api/relay",
    }));

    const httpRes = await proxyPoolsRoute.POST(
      makeJsonRequest("http://localhost:20128/api/proxy-pools", "POST", {
        name: "Local HTTP Proxy",
        type: "http",
        proxyUrl: "http://user:pass@127.0.0.1:8080",
      })
    );
    expect(httpRes.status).toBe(201);
  });

  it("PUT /api/proxy-pools/[id] rejects blocked relay URLs and unsafe http->relay type switches", async () => {
    mocks.getProxyPoolById.mockResolvedValue({
      id: "p1",
      name: "Relay",
      type: "cloudflare",
      proxyUrl: "https://my-worker.example.workers.dev",
    });

    const badUpdate = await proxyPoolDetailRoute.PUT(
      makeJsonRequest("http://localhost:20128/api/proxy-pools/p1", "PUT", {
        proxyUrl: "http://169.254.169.254/latest/meta-data/",
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(badUpdate.status).toBe(400);
    expect(mocks.updateProxyPool).not.toHaveBeenCalled();

    mocks.getProxyPoolById.mockResolvedValue({
      id: "p2",
      name: "Local HTTP",
      type: "http",
      proxyUrl: "http://127.0.0.1:8080",
    });

    const unsafeSwitch = await proxyPoolDetailRoute.PUT(
      makeJsonRequest("http://localhost:20128/api/proxy-pools/p2", "PUT", {
        type: "vercel",
      }),
      { params: Promise.resolve({ id: "p2" }) }
    );
    expect(unsafeSwitch.status).toBe(400);
    expect(mocks.updateProxyPool).not.toHaveBeenCalled();
  });

  it.each([
    ["vercel", "http://169.254.169.254/latest/meta-data/"],
    ["cloudflare", "https://127.0.0.1:20128/api/settings"],
    ["vercel", "https://10.0.0.1/internal"],
    ["cloudflare", "http://my-worker.example.workers.dev"],
  ])("POST /api/proxy-pools/[id]/test blocks %s relay URL %s without fetching", async (type, proxyUrl) => {
    mocks.getProxyPoolById.mockResolvedValue({ id: "p1", name: "Bad Relay", type, proxyUrl });

    const res = await proxyPoolTestRoute.POST(
      new Request("http://localhost:20128/api/proxy-pools/p1/test", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) }
    );

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeTruthy();
    expect(mocks.undiciFetch).not.toHaveBeenCalled();
    expect(mocks.updateProxyPool).toHaveBeenCalledWith("p1", expect.objectContaining({
      testStatus: "error",
      isActive: false,
    }));
  });

  it("POST /api/proxy-pools/[id]/test probes public HTTPS relays with guarded dispatcher and redirect:manual", async () => {
    const cancel = vi.fn(async () => {});
    mocks.getProxyPoolById.mockResolvedValue({
      id: "p1",
      name: "Good Relay",
      type: "vercel",
      proxyUrl: "https://my-relay.vercel.app/api/relay",
    });
    mocks.undiciFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      body: { cancel },
    });

    const res = await proxyPoolTestRoute.POST(
      new Request("http://localhost:20128/api/proxy-pools/p1/test", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) }
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mocks.undiciFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.undiciFetch.mock.calls[0];
    expect(url).toBe("https://my-relay.vercel.app/api/relay");
    expect(init.redirect).toBe("manual");
    expect(init.dispatcher).toBeTruthy();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("POST /api/proxy-pools/[id]/test does not follow redirects from a relay", async () => {
    mocks.getProxyPoolById.mockResolvedValue({
      id: "p1",
      name: "Redirect Relay",
      type: "cloudflare",
      proxyUrl: "https://my-worker.example.workers.dev",
    });
    mocks.undiciFetch.mockResolvedValueOnce({
      ok: false,
      status: 302,
      statusText: "Found",
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
    });

    const res = await proxyPoolTestRoute.POST(
      new Request("http://localhost:20128/api/proxy-pools/p1/test", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) }
    );

    expect(res.body.ok).toBe(false);
    expect(res.body.status).toBe(302);
    expect(mocks.undiciFetch).toHaveBeenCalledTimes(1);
  });
});
