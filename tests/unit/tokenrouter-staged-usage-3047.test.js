import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getTokenRouterUsage } from "../../open-sse/services/usage/tokenrouterQuotaAdapter.js";

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
const wallet = { data: { topUpBalance: 70, voucherEfficientAmount: 30.019508 } };
const key = { name: "production", used_quota: 2.5, remain_quota: 7.5, unlimited_quota: false, status: 1, expired_time: 1800000000 };
const page = (items = [key]) => ({ data: { items } });
const connection = { managementApiKey: "management-one", apiKey: "inference-secret" };

beforeEach(() => vi.resetAllMocks());

describe("staged TokenRouter usage", () => {
  it("maps the two fixed authenticated reads and preserves selected proxy", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(wallet)).mockResolvedValueOnce(reply(page([key, { ...key, name: "unlimited", unlimited_quota: true, expired_time: -1 }])));
    const proxy = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example:8080" };
    const result = await getTokenRouterUsage({ ...connection, baseUrl: "https://evil.example", providerSpecificData: { managementKey: "wrong", quotaEndpoint: "https://evil.example" } }, proxy);
    expect(proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual(["https://api.tokenrouter.com/api/management/self/wallet", "https://api.tokenrouter.com/api/management/api-keys?page=1&page_size=100"]);
    for (const [, options, route] of proxyAwareFetch.mock.calls) {
      expect(options).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: "Bearer management-one" } });
      expect(route).toEqual({ ...proxy, strictProxy: true });
    }
    expect(result.quotas["Account Balance"]).toMatchObject({ total: 100.019508, currency: "USD", isCreditBalance: true });
    expect(result.quotas["Key: production"]).toMatchObject({ used: 2.5, total: 10, remaining: 7.5, expiresAt: "2027-01-15T08:00:00.000Z", neverExpires: false });
    expect(result.quotas["Key: unlimited"]).toMatchObject({ unlimited: true, neverExpires: true, expiresAt: null });
    expect(result.quotas["Key: unlimited"]).not.toHaveProperty("total");
  });
  it("does not use inference or nested credentials", async () => {
    for (const input of [{ apiKey: "inference" }, { managementApiKey: "  " }, { managementApiKey: "bad\nkey" }, { providerSpecificData: { managementKey: "nested" } }]) {
      expect((await getTokenRouterUsage(input)).message).toMatch(/unavailable/i);
    }
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
  it("isolates concurrent credentials and proxies", async () => {
    proxyAwareFetch.mockImplementation(async (url) => reply(url.endsWith("wallet") ? wallet : page()));
    const one = { connectionProxyEnabled: true, connectionProxyUrl: "http://one:80" };
    const two = { connectionProxyEnabled: true, connectionProxyUrl: "http://two:80" };
    await Promise.all([getTokenRouterUsage(connection, one), getTokenRouterUsage({ managementApiKey: "management-two" }, two)]);
    for (const [, options, proxy] of proxyAwareFetch.mock.calls) expect([options.headers.Authorization, proxy.connectionProxyUrl]).toEqual(proxy.connectionProxyUrl.includes("one") ? ["Bearer management-one", "http://one:80"] : ["Bearer management-two", "http://two:80"]);
  });
  it("reports partial wallet failures and pagination without inventing a balance", async () => {
    proxyAwareFetch.mockRejectedValueOnce(new Error("management-one")).mockResolvedValueOnce(reply({ data: { items: [key], total: 101 } }));
    const result = await getTokenRouterUsage(connection);
    expect(result.message).toMatch(/Wallet balance is unavailable/);
    expect(result.message).toMatch(/first 100/);
    expect(result.quotas).not.toHaveProperty("Account Balance");
    expect(JSON.stringify(result)).not.toContain("management-one");
  });
  it.each([401, 403, 500, 302])("reports HTTP %s without returning fabricated quotas", async (status) => {
    proxyAwareFetch.mockResolvedValueOnce(reply(wallet)).mockResolvedValueOnce(reply({}, status));
    expect(await getTokenRouterUsage(connection)).toMatchObject({ quotas: {}, message: expect.any(String) });
  });
  it("rejects malformed responses, redirects, and relay overrides", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(wallet)).mockResolvedValueOnce(reply({ data: {} }));
    expect((await getTokenRouterUsage(connection)).quotas).toEqual({});
    proxyAwareFetch.mockReset().mockResolvedValueOnce(reply(wallet)).mockResolvedValueOnce(reply(page([{ ...key, used_quota: null }])));
    expect((await getTokenRouterUsage(connection)).quotas).toEqual({});
    proxyAwareFetch.mockReset().mockResolvedValueOnce(reply(wallet)).mockResolvedValueOnce({ ok: true, redirected: true });
    expect((await getTokenRouterUsage(connection)).quotas).toEqual({});
    proxyAwareFetch.mockReset();
    expect((await getTokenRouterUsage(connection, { vercelRelayUrl: "https://evil.example" })).message).toMatch(/relay/);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
  it("redacts transport and JSON errors", async () => {
    proxyAwareFetch.mockRejectedValue(new Error("management-one https://evil.example"));
    const result = await getTokenRouterUsage(connection);
    expect(result.quotas).toEqual({});
    expect(JSON.stringify(result)).not.toMatch(/management-one|evil/);
  });
});
