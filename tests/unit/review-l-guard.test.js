import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  valid: false,
  settings: { requireLogin: false, tunnelDashboardAccess: true },
  lookedUp: [],
  locked: false,
  fails: [],
}));

vi.mock("next/server", () => ({ NextResponse: class extends Response {
  static next() { return new Response(null, { status: 200 }); }
  static json(body, init) { return Response.json(body, init); }
  static redirect(url) { return Response.redirect(url); }
} }));
vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: async (key) => { state.lookedUp.push(key); return key === "real-key" ? { id: "k1", isActive: true, policy: { modelAccess: { mode: "allow", patterns: ["openai/allowed"] } } } : null; },
  getApiKeyProviderConnectionIds: async () => [], getProviderNodes: async () => [],
  getSettings: async () => state.settings,
  validateApiKey: async () => state.valid,
  validateGatewayKey: async () => false,
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "cli" }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async (token) => token === "session" }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: () => true }));
vi.mock("@/lib/auth/loginLimiter.js", () => ({
  checkLock: () => state.locked ? { locked: true, retryAfter: 30 } : { locked: false },
  getClientIp: () => "198.51.100.2",
  recordFail: (ip) => state.fails.push(ip), recordSuccess: vi.fn(),
}));
vi.mock("@/mitm/controlProof", async () => await import("../../src/mitm/controlProof.js"));
vi.mock("@/lib/auth/requestOrigin", () => ({ hasExactRequestOrigin: () => false }));
vi.mock("@/lib/auth/oidc", () => ({ fetchOidcDiscovery: vi.fn(), probeOidcClientSecret: vi.fn(), getPublicOrigin: () => "http://localhost" }));
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: (request) => request.headers.get("authorization")?.slice(7) || null,
  resolveClientApiKey: async (request) => ({ apiKey: request.headers.get("x-api-key") === "real-key" ? "real-key" : null }),
  hasValidCliToken: async () => false,
}));

const { proxy } = await import("../../src/dashboardGuard.js");
const access = await import("../../src/sse/services/modelAccess.js");

function request(path, headers = {}, method = "GET") {
  const url = new URL(path, "http://remote.example");
  const normalized = new Headers({ host: "remote.example", ...headers });
  return { url: url.href, nextUrl: { pathname: url.pathname, searchParams: url.searchParams }, headers: normalized, method, cookies: { get: (name) => ({ value: normalized.get("cookie")?.split("=")[1] }) } };
}

describe("l-guard regressions", () => {
  beforeEach(() => { state.valid = false; state.locked = false; state.fails = []; state.lookedUp = []; });

  it("throttles failed remote API-key authentication", async () => {
    const denied = await proxy(request("/v1/chat/completions", { authorization: "Bearer sk-12345678" }, "POST"));
    expect(denied.status).toBe(401);
    expect(state.fails).toEqual(["198.51.100.2"]);
    state.locked = true;
    expect((await proxy(request("/v1/chat/completions", { authorization: "Bearer sk-12345678" }, "POST"))).status).toBe(429);
  });

  it("uses the credential resolved by auth for model filtering and discovery", async () => {
    const req = request("/v1/models", { authorization: "Bearer junk", "x-api-key": "real-key" });
    const models = await access.filterModelsForRequest(req, [{ id: "openai/allowed" }, { id: "openai/private" }]);
    expect(models).toEqual([{ id: "openai/allowed" }]);
    await access.getRequestConnectionScope(req);
    await access.getRequestModelDiscoveryOptions(req);
    expect(state.lookedUp).toEqual(["real-key", "real-key", "real-key"]);
  });

  it("requires a session for remote dashboard pages when login is disabled", async () => {
    expect((await proxy(request("/dashboard"))).status).toBe(302);
    expect((await proxy(request("/dashboard", { cookie: "auth_token=session" }))).status).toBe(200);
  });
});
