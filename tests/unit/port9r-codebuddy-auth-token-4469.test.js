// Port of decolua/9router #4469: CodeBuddy CN auth_token third auth mode + real billing probe.
import { afterEach, describe, expect, it, vi } from "vitest";
import codebuddyCn from "../../open-sse/providers/registry/codebuddy-cn.js";
import codebuddyIntl from "../../open-sse/providers/registry/codebuddy-intl.js";
import { isUsageEligible } from "../../src/app/api/providers/client/route.js";
import {
  OAUTH_STATUS_AUTH_TYPES,
  getProviderStatus,
} from "../../src/app/(dashboard)/dashboard/providers/providerFilters.js";

const mockConnections = vi.hoisted(() => new Map());
const mockCreate = vi.hoisted(() => vi.fn(async (data) => {
  const conn = { id: `conn-${mockConnections.size + 1}`, ...data };
  mockConnections.set(conn.id, conn);
  return conn;
}));
const mockUpdate = vi.hoisted(() => vi.fn(async (id, patch) => {
  const existing = mockConnections.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  mockConnections.set(id, updated);
  return updated;
}));
const mockGetUsageForProvider = vi.hoisted(() => vi.fn());

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(async (id) => mockConnections.get(id) ?? null),
  getProviderConnections: vi.fn(async () => Array.from(mockConnections.values())),
  createProviderConnection: mockCreate,
  updateProviderConnection: mockUpdate,
  getProviderNodeById: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(async (id) => mockConnections.get(id) ?? null),
  getProviderConnections: vi.fn(async () => Array.from(mockConnections.values())),
  updateProviderConnection: mockUpdate,
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: vi.fn(async () => true),
  isNonAdminApiKeyCaller: vi.fn(async () => false),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    vercelRelayUrl: "",
    strictProxy: false,
    disableEnvProxy: false,
  })),
  testProxyUrl: vi.fn(async () => ({ ok: true })),
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: mockGetUsageForProvider,
}));

const { createProvider } = await import("@/lib/providerRouteHandlers.js");
const {
  testSingleConnection,
  __setProviderTestFetchForTesting,
} = await import("@/app/api/providers/[id]/test/testUtils.js");
const usageRoute = await import("@/app/api/usage/[connectionId]/route.js");

let restoreFetch = null;

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
  mockConnections.clear();
  mockCreate.mockClear();
  mockUpdate.mockClear();
  mockGetUsageForProvider.mockReset();
  vi.restoreAllMocks();
});

describe("CodeBuddy CN auth_token mode (#4469)", () => {
  it("exposes oauth, apikey, and auth_token on codebuddy-cn without changing codebuddy-intl", () => {
    expect(codebuddyCn.authModes).toEqual(["oauth", "apikey", "auth_token"]);
    expect(codebuddyIntl.authModes).toBeUndefined();
    expect(codebuddyIntl.category).toBe("apikey");
  });

  it("persists authType auth_token for codebuddy-cn and rejects it for providers without auth_token mode", async () => {
    const okRes = await createProvider(
      new Request("http://localhost/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "codebuddy-cn",
          authType: "auth_token",
          name: "cn-jwt",
          apiKey: "eyJ-test-token",
        }),
      }),
    );
    expect(okRes.status).toBe(201);
    const created = await okRes.json();
    expect(created.connection.authType).toBe("auth_token");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codebuddy-cn",
        authType: "auth_token",
        name: "cn-jwt",
        apiKey: "eyJ-test-token",
      }),
      expect.any(Object),
    );

    const badRes = await createProvider(
      new Request("http://localhost/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          authType: "auth_token",
          name: "bad",
          apiKey: "sk-test",
        }),
      }),
    );
    expect(badRes.status).toBe(400);
    expect((await badRes.json()).error).toContain("Auth token mode is not supported");
  });

  it("counts codebuddy-cn auth_token connections for dashboard status and usage eligibility", () => {
    expect(OAUTH_STATUS_AUTH_TYPES).toContain("auth_token");
    expect(
      getProviderStatus(
        [{ provider: "codebuddy-cn", authType: "auth_token", isActive: true }],
        "codebuddy-cn",
        OAUTH_STATUS_AUTH_TYPES,
      ),
    ).toBe("active");

    expect(
      isUsageEligible({
        provider: "codebuddy-cn",
        authType: "auth_token",
        isActive: true,
      }),
    ).toBe(true);
    expect(
      isUsageEligible({
        provider: "codebuddy-cn",
        authType: "auth_token",
        isActive: false,
      }),
    ).toBe(false);
  });

  it("tests codebuddy-cn auth_token and oauth connections against the Tencent billing probe", async () => {
    const calls = [];
    restoreFetch = __setProviderTestFetchForTesting(async (url, opts) => {
      calls.push({ url, opts });
      const auth = opts?.headers?.Authorization;
      if (auth === "Bearer valid-jwt") {
        return new Response(JSON.stringify({ code: 0, data: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (auth === "Bearer rejected-body-jwt") {
        return new Response(JSON.stringify({ code: 10001, msg: "invalid token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("unauthorized", { status: 401 });
    });

    mockConnections.set("cb-auth-ok", {
      id: "cb-auth-ok",
      provider: "codebuddy-cn",
      authType: "auth_token",
      apiKey: "valid-jwt",
      isActive: true,
    });
    const okRes = await testSingleConnection("cb-auth-ok");
    expect(okRes.valid).toBe(true);
    expect(calls[0].url).toBe("https://copilot.tencent.com/v2/billing/meter/get-user-resource");
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer valid-jwt");

    mockConnections.set("cb-auth-bad", {
      id: "cb-auth-bad",
      provider: "codebuddy-cn",
      authType: "auth_token",
      apiKey: "revoked-jwt",
      isActive: true,
    });
    const badRes = await testSingleConnection("cb-auth-bad");
    expect(badRes.valid).toBe(false);
    expect(badRes.error).toContain("Token invalid or revoked");

    mockConnections.set("cb-auth-code", {
      id: "cb-auth-code",
      provider: "codebuddy-cn",
      authType: "auth_token",
      apiKey: "rejected-body-jwt",
      isActive: true,
    });
    const codeRes = await testSingleConnection("cb-auth-code");
    expect(codeRes.valid).toBe(false);
    expect(codeRes.error).toContain("invalid token");

    // OAuth connections also run the real billing probe (no longer tokenExists no-op).
    mockConnections.set("cb-oauth-bad", {
      id: "cb-oauth-bad",
      provider: "codebuddy-cn",
      authType: "oauth",
      accessToken: "expired-oauth",
      isActive: true,
    });
    const oauthBad = await testSingleConnection("cb-oauth-bad");
    expect(oauthBad.valid).toBe(false);
    expect(oauthBad.error).toContain("Token invalid or revoked");
  });

  it("allows GET /api/usage/[connectionId] for codebuddy-cn auth_token connections", async () => {
    mockGetUsageForProvider.mockResolvedValueOnce({
      quotas: { Monthly: { used: 12.5, total: 500, recurring: true } },
    });

    mockConnections.set("cb-usage-1", {
      id: "cb-usage-1",
      provider: "codebuddy-cn",
      authType: "auth_token",
      apiKey: "usage-jwt",
      isActive: true,
    });

    const res = await usageRoute.GET(
      new Request("http://localhost/api/usage/cb-usage-1"),
      { params: Promise.resolve({ connectionId: "cb-usage-1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBeUndefined();
    expect(body.quotas?.Monthly).toMatchObject({ used: 12.5, total: 500 });
    expect(mockGetUsageForProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codebuddy-cn",
        authType: "auth_token",
        apiKey: "usage-jwt",
      }),
      expect.any(Object),
      expect.any(Object),
    );
  });
});
