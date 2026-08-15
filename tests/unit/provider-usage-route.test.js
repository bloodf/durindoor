import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getUsageHistory: vi.fn(),
  getUsageForProvider: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  backfillCursorConnectionIdentity: vi.fn(async (connection) => connection),
  refreshAndUpdateCredentials: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.getProviderConnectionById }));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ getUsageHistory: mocks.getUsageHistory }));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: mocks.getUsageForProvider }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig }));
vi.mock("@/shared/constants/providers", () => ({ USAGE_APIKEY_PROVIDERS: ["glm"] }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({
  backfillCursorConnectionIdentity: mocks.backfillCursorConnectionIdentity,
}));
vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));

describe("provider usage route credential service integration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });

  it("uses the refreshed OAuth connection and retries one forced refresh after an auth-expired result", async () => {
    const connection = {
      id: "conn-1", provider: "github", authType: "oauth", accessToken: "old-token", refreshToken: "refresh-token", providerSpecificData: {},
    };
    const refreshed = { ...connection, accessToken: "new-token" };
    const forced = { ...connection, accessToken: "forced-token" };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.refreshAndUpdateCredentials
      .mockResolvedValueOnce({ connection: refreshed, refreshed: true })
      .mockResolvedValueOnce({ connection: forced, refreshed: true });
    mocks.getUsageForProvider
      .mockResolvedValueOnce({ message: "Unauthorized 401; re-authorize" })
      .mockResolvedValueOnce({ plan: "Business", quotas: { chat: { remaining: 10 } } });
    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ plan: "Business" });
    expect(mocks.refreshAndUpdateCredentials).toHaveBeenNthCalledWith(1, connection, false, expect.any(Object));
    expect(mocks.refreshAndUpdateCredentials).toHaveBeenNthCalledWith(2, refreshed, true, expect.any(Object));
    expect(mocks.getUsageForProvider).toHaveBeenNthCalledWith(1, refreshed, expect.any(Object), { force: false });
    expect(mocks.getUsageForProvider).toHaveBeenNthCalledWith(2, forced, expect.any(Object), { force: false });
  });

  it("never invokes OAuth refresh for an eligible API-key provider", async () => {
    const connection = { id: "conn-glm", provider: "glm", authType: "apikey", apiKey: "key", providerSpecificData: {} };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getUsageForProvider.mockResolvedValue({ plan: "Pro", quotas: {} });
    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    const response = await GET(new Request("http://localhost/api/usage/conn-glm"), {
      params: Promise.resolve({ connectionId: "conn-glm" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.refreshAndUpdateCredentials).not.toHaveBeenCalled();
    expect(mocks.getUsageForProvider).toHaveBeenCalledWith(connection, expect.any(Object), { force: false });
  });

  it("forwards force=1 to both initial and OAuth-retry usage calls", async () => {
    const connection = {
      id: "conn-1", provider: "github", authType: "oauth", accessToken: "old", refreshToken: "refresh", providerSpecificData: {},
    };
    const refreshed = { ...connection, accessToken: "new" };
    const forced = { ...connection, accessToken: "forced" };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.refreshAndUpdateCredentials.mockResolvedValueOnce({ connection: refreshed }).mockResolvedValueOnce({ connection: forced });
    mocks.getUsageForProvider.mockResolvedValueOnce({ message: "Unauthorized 401" }).mockResolvedValueOnce({ quotas: {} });
    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    await GET(new Request("http://localhost/api/usage/conn-1?force=1"), { params: Promise.resolve({ connectionId: "conn-1" }) });

    expect(mocks.getUsageForProvider).toHaveBeenNthCalledWith(1, refreshed, expect.any(Object), { force: true });
    expect(mocks.getUsageForProvider).toHaveBeenNthCalledWith(2, forced, expect.any(Object), { force: true });
  });

  it("redacts refresh failures in both the response and log", async () => {
    const canary = "sk-usageroutesecret123456";
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-1", provider: "github", authType: "oauth", accessToken: "old-token", providerSpecificData: {},
    });
    mocks.refreshAndUpdateCredentials.mockRejectedValue(new Error(`upstream ${canary}`));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    try {
      const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
        params: Promise.resolve({ connectionId: "conn-1" }),
      });
      const body = await response.json();
      expect(response.status).toBe(401);
      expect(JSON.stringify(body)).not.toContain(canary);
      expect(JSON.stringify(body)).toContain("[redacted]");
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(canary);
    } finally {
      errorLog.mockRestore();
    }
  });
});
