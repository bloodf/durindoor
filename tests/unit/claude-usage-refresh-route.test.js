import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  id: "claude-refresh", provider: "claude", authType: "oauth",
  accessToken: "fixture-only-claude-refresh", providerSpecificData: {},
}));
const upstream = vi.hoisted(() => vi.fn());
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: async () => connection }));
vi.mock("@/lib/db/repos/monitoringUsageRepo.js", () => ({ getConnectionUsageSummary: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ backfillCursorConnectionIdentity: async (value) => value }));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: async (value) => ({ connection: value }) }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: upstream }));

import { GET } from "../../src/app/api/usage/[connectionId]/route.js";
import { __clearOAuthQuotaCacheForTesting } from "../../open-sse/services/usage/claude.js";

const response = (percent, status = 200) => new Response(JSON.stringify({
  seven_day: { utilization: percent, resets_at: "2026-10-13T03:00:00Z" },
}), { status, headers: { "Content-Type": "application/json" } });
const requestUsage = async (query = "") => (await GET(
  new Request(`http://localhost/api/usage/claude-refresh${query}`),
  { params: Promise.resolve({ connectionId: connection.id }) },
)).json();

describe("Claude usage explicit refresh API", () => {
  beforeEach(() => {
    upstream.mockReset();
    __clearOAuthQuotaCacheForTesting();
  });

  it("refresh=1 replaces a fresh cached value but a 429 retains it without repeated upstream polls", async () => {
    upstream.mockResolvedValueOnce(response(9));
    expect((await requestUsage()).quotas["weekly (7d)"].used).toBe(9);
    expect((await requestUsage()).quotas["weekly (7d)"].used).toBe(9);
    expect(upstream).toHaveBeenCalledTimes(1);

    upstream.mockResolvedValueOnce(response(23));
    expect((await requestUsage("?refresh=1")).quotas["weekly (7d)"].used).toBe(23);
    expect(upstream).toHaveBeenCalledTimes(2);

    upstream.mockResolvedValueOnce(response(0, 429));
    const limited = await requestUsage("?refresh=1");
    expect(limited).toMatchObject({ stale: true, rateLimited: true });
    expect(limited.quotas["weekly (7d)"].used).toBe(23);
    expect(await requestUsage("?refresh=1")).toEqual(limited);
    expect(upstream).toHaveBeenCalledTimes(3);
  });
});
