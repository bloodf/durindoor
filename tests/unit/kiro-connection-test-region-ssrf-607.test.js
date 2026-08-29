import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    vercelRelayUrl: "",
  })),
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(),
}));

// Exercise refreshOAuthToken through testSingleConnection. Production currently
// serializes Kiro refreshes, which suppresses proactive dashboard refresh; the
// boundary still must remain safe if refresh policy permits this call path.
vi.mock("open-sse/services/refreshSerializer.js", () => ({
  rotationGroupFor: vi.fn(() => null),
}));

const originalFetch = globalThis.fetch;
let restoreProviderFetch = null;

function expiredKiro(region) {
  return {
    id: "kiro-connection",
    provider: "kiro",
    authType: "oauth",
    accessToken: "expired-access-token",
    refreshToken: "refresh-token",
    expiresAt: "2020-01-01T00:00:00.000Z",
    providerSpecificData: {
      clientId: "client-id",
      clientSecret: "client-secret",
      region,
      authMethod: "idc",
    },
  };
}

describe("Kiro dashboard connection-test region boundary (issue #607)", () => {
  beforeEach(() => {
    restoreProviderFetch?.();
    restoreProviderFetch = null;
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    restoreProviderFetch?.();
    restoreProviderFetch = null;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.each([
    "us-east-1.evil.example",
    "us-east-1@169.254.169.254",
    "../../169.254.169.254",
    123,
  ])("rejects tampered stored region %j without outbound traffic", async (region) => {
    mocks.getProviderConnectionById.mockResolvedValue(expiredKiro(region));
    const fetchSpy = vi.fn();
    const { testSingleConnection, __setProviderTestFetchForTesting } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    restoreProviderFetch = __setProviderTestFetchForTesting(fetchSpy);

    const result = await testSingleConnection("kiro-connection");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/refresh failed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a valid stored region unchanged for the OIDC refresh request", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(expiredKiro("eu-central-1"));
    const fetchSpy = vi.fn(async (url) => {
      expect(String(url)).toBe("https://oidc.eu-central-1.amazonaws.com/token");
      return new Response(JSON.stringify({
        accessToken: "new-access-token",
        refreshToken: "rotated-refresh-token",
        expiresIn: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const { testSingleConnection, __setProviderTestFetchForTesting } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    restoreProviderFetch = __setProviderTestFetchForTesting(fetchSpy);

    const result = await testSingleConnection("kiro-connection");

    expect(result.valid).toBe(true);
    expect(result.refreshed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
