import { beforeEach, describe, expect, it, vi } from "vitest";

// Route wiring for the xAI SuperGrok weekly quota. The xai OAuth token CAN read
// grok.com's GetGrokCreditsConfig (verified live), so the usage route surfaces
// the real weekly %+reset as the primary row, falling back to local history.
const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getUsageHistory: vi.fn(),
  getUsageForProvider: vi.fn(),
  fetchGrokCliCreditsConfig: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  backfillCursorConnectionIdentity: vi.fn(async (c) => c),
  refreshAndUpdateCredentials: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.getProviderConnectionById }));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ getUsageHistory: mocks.getUsageHistory }));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: mocks.getUsageForProvider }));
vi.mock("open-sse/services/usage/grok-cli.js", () => ({
  fetchGrokCliCreditsConfig: mocks.fetchGrokCliCreditsConfig,
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig }));
vi.mock("@/shared/constants/providers", () => ({ USAGE_APIKEY_PROVIDERS: [] }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({
  backfillCursorConnectionIdentity: mocks.backfillCursorConnectionIdentity,
}));
vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));

const xaiConnection = () => ({
  id: "conn-xai",
  provider: "xai",
  authType: "oauth",
  accessToken: "xai-token",
  refreshToken: "r",
  providerSpecificData: {},
});

async function callRoute() {
  const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
  const res = await GET(new Request("http://localhost/api/usage/conn-xai"), {
    params: Promise.resolve({ connectionId: "conn-xai" }),
  });
  return { res, body: await res.json() };
}

describe("xAI SuperGrok weekly quota in the usage route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getProviderConnectionById.mockResolvedValue(xaiConnection());
    mocks.refreshAndUpdateCredentials.mockImplementation(async (c) => ({ connection: c, refreshed: false }));
    // One local request so aggregateLocalUsage produces rows too.
    mocks.getUsageHistory.mockResolvedValue([
      { connectionId: "conn-xai", model: "grok-4.6", cost: 0.25, tokens: { prompt_tokens: 100, completion_tokens: 50 } },
    ]);
  });

  it("surfaces the real Weekly SuperGrok row when GetGrokCreditsConfig resolves", async () => {
    mocks.fetchGrokCliCreditsConfig.mockResolvedValue({
      percentUsed: 100,
      resetAt: "2026-08-20T13:29:52.459Z",
    });

    const { res, body } = await callRoute();

    expect(res.status).toBe(200);
    expect(body.quotas["Weekly SuperGrok"]).toEqual({
      used: 100,
      total: 100,
      remainingPercentage: 0,
      resetAt: "2026-08-20T13:29:52.459Z",
      unlimited: false,
    });
    // Local-history rows are preserved alongside the real weekly quota.
    expect(body.quotas["Total tokens (30d)"]).toBeDefined();
    expect(mocks.fetchGrokCliCreditsConfig).toHaveBeenCalledWith("xai-token", expect.any(Object));
    expect(body.displayMessage).toContain("SuperGrok weekly pool 100% used");
  });

  it("rounds a fractional percent and clamps to 0..100", async () => {
    mocks.fetchGrokCliCreditsConfig.mockResolvedValue({ percentUsed: 34.999, resetAt: null });
    const { body } = await callRoute();
    expect(body.quotas["Weekly SuperGrok"].used).toBe(35);
    expect(body.quotas["Weekly SuperGrok"].remainingPercentage).toBe(65);
  });

  it("falls back to local-history-only when the credits call returns null", async () => {
    mocks.fetchGrokCliCreditsConfig.mockResolvedValue(null);
    const { res, body } = await callRoute();
    expect(res.status).toBe(200);
    expect(body.quotas["Weekly SuperGrok"]).toBeUndefined();
    expect(body.quotas["Total tokens (30d)"]).toBeDefined();
    expect(body.plan).toBe("xAI / Grok Build");
  });

  it("fails open to local history when the credits call throws", async () => {
    mocks.fetchGrokCliCreditsConfig.mockRejectedValue(new Error("network"));
    const { res, body } = await callRoute();
    expect(res.status).toBe(200);
    expect(body.quotas["Weekly SuperGrok"]).toBeUndefined();
    expect(body.quotas["Total tokens (30d)"]).toBeDefined();
  });
});
