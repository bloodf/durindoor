import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getConnectionUsageSummary: vi.fn(),
  fetchGrokCliCreditsConfig: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.getProviderConnectionById }));
vi.mock("@/lib/db/repos/monitoringUsageRepo.js", () => ({ getConnectionUsageSummary: mocks.getConnectionUsageSummary }));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: vi.fn() }));
vi.mock("open-sse/services/usage/grok-cli.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchGrokCliCreditsConfig: mocks.fetchGrokCliCreditsConfig,
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({ strictProxy: true })) }));
vi.mock("@/shared/constants/providers", () => ({ USAGE_APIKEY_PROVIDERS: [] }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ backfillCursorConnectionIdentity: vi.fn(async (c) => c) }));
vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: vi.fn(async (connection) => ({ connection, refreshed: false })),
}));

const BILLING = { config: { onDemandCap: { val: 100 }, onDemandUsed: { val: 35 }, prepaidBalance: { val: 12 } } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function stubBilling({ billing = () => json(BILLING), user = () => json({ subscriptionTier: "SuperGrok" }) } = {}) {
  mocks.proxyAwareFetch.mockImplementation(async (url) => (String(url).includes("/user") ? user() : billing()));
}

async function callRoute() {
  const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
  const res = await GET(new Request("http://localhost/api/usage/conn-xai"), {
    params: Promise.resolve({ connectionId: "conn-xai" }),
  });
  return res.json();
}

describe("xAI OAuth account plan and credits (upstream decolua/9router#2672)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Offline guard: nothing in this file may reach a live host.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected direct fetch"); }));
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-xai", provider: "xai", authType: "oauth", accessToken: "xai-token", providerSpecificData: {},
    });
    mocks.getConnectionUsageSummary.mockResolvedValue({ requests: 0 });
    mocks.fetchGrokCliCreditsConfig.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows the subscription plan and credit quotas without local request history", async () => {
    stubBilling();

    const body = await callRoute();

    expect(body.plan).toBe("Super Grok");
    expect(body.quotas["On-demand"]).toMatchObject({ used: 35, total: 100, remainingPercentage: 65 });
    expect(body.quotas.Prepaid).toMatchObject({ total: 12 });
    // The dashboard hides the quota table while `message` is set.
    expect(body.message).toBeUndefined();
    const userCall = mocks.proxyAwareFetch.mock.calls.find(([url]) => url.includes("/user"));
    expect(userCall[1].headers.Authorization).toBe("Bearer xai-token");
    // Both reads keep the connection's egress policy.
    expect(mocks.proxyAwareFetch.mock.calls.map((call) => call[2]?.strictProxy)).toEqual([true, true]);
  });

  it("keeps billing quotas when the user profile read fails", async () => {
    stubBilling({ user: () => json({ error: "nope" }, 500) });

    const body = await callRoute();

    expect(body.plan).toBe("Grok Build");
    expect(body.quotas["On-demand"]).toMatchObject({ used: 35, total: 100 });
  });

  it("falls back to the local-history card when billing is rejected", async () => {
    stubBilling({ billing: () => json({ error: "unauthorized" }, 401) });

    const body = await callRoute();

    expect(body.quotas).toEqual({});
    expect(body.message).toContain("No requests recorded");
  });

  it("does not repeat the weekly pool as a second Credits row", async () => {
    stubBilling({ billing: () => json({ config: { creditUsagePercent: 40 } }) });
    mocks.fetchGrokCliCreditsConfig.mockResolvedValue({ percentUsed: 40, resetAt: null });

    const body = await callRoute();

    expect(Object.keys(body.quotas)).toEqual(["Weekly SuperGrok"]);
    expect(body.plan).toBe("Super Grok");
  });
});
