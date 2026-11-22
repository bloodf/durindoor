import { describe, expect, it, vi } from "vitest";
import {
  extractZedHostedPortalToken,
  fetchZedHostedQuota,
  normalizeZedHostedQuota
} from "../../open-sse/services/quota/providers/zedHosted.js";
import { getProviderQuotaAdapter } from "../../open-sse/services/quota/providers/index.js";

const portalToken = "synthetic-portal-token-123";
const ledger = {
  credits_balance: "7.25",
  credit_blocks: [
    { balance: null, maximum_initial_balance: 20, expiry_date: "2027-01-01T00:00:00Z" },
    { balance: "12.75", maximum_initial_balance: "20", expiry_date: "2027-02-01T00:00:00Z" }
  ]
};

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function context({
  connectionId = "zed-account-a",
  billingPortalUrl = portalToken,
  omitBillingPortalUrl = false,
  fetchImpl
} = {}) {
  const adapter = getProviderQuotaAdapter("zed-hosted");
  expect(adapter).not.toBeNull();
  const providerSpecificData = omitBillingPortalUrl ? {} : { billingPortalUrl };
  return {
    config: adapter.config,
    connection: {
      id: connectionId,
      provider: "zed-hosted",
      providerSpecificData
    },
    fetchImpl,
    now: () => Date.parse("2026-11-01T00:00:00Z"),
    timeoutMs: 1000,
    maxResponseBytes: 8192
  };
}

describe("extractZedHostedPortalToken", () => {
  it("accepts a bare token or an exact Orb portal link", () => {
    expect(extractZedHostedPortalToken(portalToken)).toBe(portalToken);
    expect(
      extractZedHostedPortalToken(`https://portal.withorb.com/view?token=${portalToken}`)
    ).toBe(portalToken);
  });

  it.each([
    ["suffix host", `https://portal.withorb.com.evil.example/view?token=${portalToken}`],
    ["userinfo", `https://attacker:secret@portal.withorb.com/view?token=${portalToken}`],
    ["http scheme", `http://portal.withorb.com/view?token=${portalToken}`],
    ["interior control chars", `${portalToken.slice(0, 8)}\n${portalToken.slice(8)}`],
    ["empty", ""]
  ])("rejects %s", (_name, value) => {
    expect(extractZedHostedPortalToken(value)).toBeNull();
  });
});

describe("Zed Hosted quota probe", () => {
  it("registers the Orb credit-ledger adapter", () => {
    expect(getProviderQuotaAdapter("zed-hosted")).toMatchObject({
      config: { adapter: "zed-hosted", sourceId: "zed-hosted:orb-credit-ledger:v1" },
      fetchQuota: expect.any(Function)
    });
  });

  it("parses the monthly credit balance for a signed-in connection", async () => {
    const fetchImpl = vi.fn().
    mockResolvedValueOnce(jsonResponse({ customer: { id: "customer_1", pricing_unit: { id: "price_1" } } })).
    mockResolvedValueOnce(jsonResponse(ledger));
    const result = await fetchZedHostedQuota(context({ fetchImpl }));
    expect(result).toMatchObject({
      outcome: "success",
      sourceId: "zed-hosted:orb-credit-ledger:v1"
    });
    expect(result.rows[0]).toMatchObject({
      state: "available",
      amounts: { limitKind: "bounded", limit: 20, used: 12.75, remaining: 7.25, unit: "usd" },
      metadata: { plan: "Zed Hosted", recurring: false }
    });
    expect(result.rows[0].resetAt).toBe("2027-02-01T00:00:00.000Z");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    expect(fetchImpl.mock.calls[0][1].headers.Referer).toBe(
      `https://portal.withorb.com/view?token=${encodeURIComponent(portalToken)}`
    );
  });

  it("returns missing when the billing portal link is absent or invalid", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchZedHostedQuota(context({ omitBillingPortalUrl: true, fetchImpl }))
    ).resolves.toMatchObject({ outcome: "missing" });
    await expect(
      fetchZedHostedQuota(
        context({
          billingPortalUrl: "https://evil.example/view?token=synthetic-portal-token-123",
          fetchImpl
        })
      )
    ).resolves.toMatchObject({ outcome: "missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an unauthenticated outcome when the portal sign-in has expired", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    await expect(fetchZedHostedQuota(context({ fetchImpl }))).resolves.toMatchObject({
      outcome: "unauthenticated"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "provider_error"]
  ])("maps HTTP %s to %s", async (status, outcome) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, status));
    await expect(fetchZedHostedQuota(context({ fetchImpl }))).resolves.toMatchObject({ outcome });
  });

  it("rejects a malformed customer payload without calling the ledger", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ customer: { id: "bad id!" } }));
    await expect(fetchZedHostedQuota(context({ fetchImpl }))).resolves.toMatchObject({
      outcome: "malformed"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid portal payload", { credits_balance: "bad", credit_blocks: [{ balance: "bad" }] }],
    ["missing current block", { credits_balance: 1, credit_blocks: [{ balance: null }] }]
  ])("rejects %s as malformed", (_name, value) => {
    expect(normalizeZedHostedQuota(value)).toBeNull();
  });

  it("keeps account observations isolated and never fetches a cross-origin redirect", async () => {
    const fetchImplA = vi.fn().
    mockResolvedValueOnce(jsonResponse({ customer: { id: "customer_1", pricing_unit: { id: "price_1" } } })).
    mockResolvedValueOnce(jsonResponse(ledger));
    const fetchImplB = vi.fn().
    mockResolvedValueOnce(jsonResponse({ customer: { id: "customer_2", pricing_unit: { id: "price_2" } } })).
    mockResolvedValueOnce(jsonResponse({ ...ledger, credits_balance: 2 }));
    const [first, second] = await Promise.all([
      fetchZedHostedQuota(context({ connectionId: "private-a", fetchImpl: fetchImplA })),
      fetchZedHostedQuota(context({ connectionId: "private-b", fetchImpl: fetchImplB }))
    ]);
    expect(first.rows[0].accountKey).not.toBe(second.rows[0].accountKey);
    expect(first.rows[0].amounts.remaining).toBe(7.25);
    expect(second.rows[0].amounts.remaining).toBe(2);
    for (const [url, options] of [...fetchImplA.mock.calls, ...fetchImplB.mock.calls]) {
      expect(new URL(url).origin).toBe("https://portal.withorb.com");
      expect(options.redirect).toBe("error");
      expect(options.headers.Referer).toContain("portal.withorb.com");
      expect(options.headers.Origin).toBe("https://portal.withorb.com");
    }
  });
});
