// Command Code usage: alpha-API mapping and the dashboard rows built from it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
const { getCommandCodeUsage } = await import("../../open-sse/services/usage/commandcode.js");
const { parseQuotaData, getRemainingPercentage } = await import(
  "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js"
);
const { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } = await import("../../src/shared/constants/providers.js");

const CREDITS = {
  credits: { monthlyCredits: 67.6466882615, purchasedCredits: 0, freeCredits: 0 },
  windowLimits: {
    limited: true,
    exceeded: null,
    fiveHour: { used: 1.1026089261, cap: 16, resetAt: 1789295134827 },
    weekly: { used: 12.3532497601, cap: 40, resetAt: 1789646219303 }
  }
};
// A plan id without a known credit cap, so the allowance comes from period spend.
const PLAN = "individual-unlisted";
const subscription = (planId) => ({ success: true, data: { planId, currentPeriodEnd: "2026-10-10T11:39:53.000Z" } });

function upstream(overrides = {}) {
  const routes = {
    whoami: { body: { success: true, org: null } },
    credits: { body: CREDITS },
    subscriptions: { body: subscription(PLAN) },
    summary: { body: { totalCost: 12.3759038402 } },
    ...overrides
  };
  proxyAwareFetch.mockImplementation(async (url) => {
    const route = routes[new URL(url).pathname.split("/").at(-1)];
    if (route.error) throw route.error;
    const status = route.status || 200;
    const text = route.text ?? JSON.stringify(route.body ?? null);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  });
}

const requestedPaths = () => proxyAwareFetch.mock.calls.map(([url]) => url.replace("https://api.commandcode.ai", ""));

describe("upstream PR #4025 - Command Code quota", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    upstream();
  });

  it("maps the credit windows and the monthly allowance", async () => {
    const out = await getUsageForProvider({ provider: "commandcode", apiKey: "user_fixture", authType: "apikey" });

    expect(out.plan).toBe(`Command Code (${PLAN})`);
    expect(out.quotas).toEqual({
      "5-hour": { used: 1.1, total: 16, remainingPercentage: 93, resetAt: "2026-09-13T10:25:34.827Z" },
      Weekly: { used: 12.35, total: 40, remainingPercentage: 69, resetAt: "2026-09-17T11:56:59.303Z" },
      // 67.65 remaining + 12.38 spent this period.
      "Monthly credits": { used: 12.38, total: 80.02, remainingPercentage: 85, resetAt: "2026-10-10T11:39:53.000Z" }
    });
  });

  it("renders dashboard rows with the reported percentages", async () => {
    const rows = parseQuotaData("commandcode", await getCommandCodeUsage("user_fixture"));

    expect(rows.map((row) => [row.name, getRemainingPercentage(row)])).toEqual([
      ["5-hour", 93], ["Weekly", 69], ["Monthly credits", 85]
    ]);
  });

  it("is polled for API-key connections", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("commandcode");
    expect(USAGE_APIKEY_PROVIDERS).toContain("commandcode");
  });

  it("sends the registry CLI identity with the key, refuses redirects and keeps the proxy policy", async () => {
    const proxyOptions = { strictProxy: true };
    await getCommandCodeUsage(" user_fixture ", proxyOptions);

    expect(proxyAwareFetch.mock.calls.length).toBe(4);
    for (const [, init, proxy] of proxyAwareFetch.mock.calls) {
      expect(init.headers).toMatchObject({
        Authorization: "Bearer user_fixture",
        "x-command-code-version": expect.any(String),
        "x-cli-environment": "production",
        "User-Agent": "cli"
      });
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(proxy).toBe(proxyOptions);
    }
  });

  it("scopes billing reads to the organization from whoami", async () => {
    upstream({ whoami: { body: { org: { id: "org 1" } } } });
    await getCommandCodeUsage("user_fixture");

    expect(requestedPaths()).toEqual([
      "/alpha/whoami",
      "/alpha/billing/credits?orgId=org%201",
      "/alpha/billing/subscriptions?orgId=org%201",
      "/alpha/usage/summary?orgId=org%201"
    ]);
  });

  it("keeps the windows when the optional reads fail", async () => {
    upstream({
      whoami: { error: new Error("socket hang up") },
      subscriptions: { error: new Error("timeout") },
      summary: { status: 500 }
    });
    const out = await getCommandCodeUsage("user_fixture");

    expect(out.plan).toBe("Command Code");
    // Without period spend the allowance is unknown, so no monthly row is invented.
    expect(Object.keys(out.quotas)).toEqual(["5-hour", "Weekly"]);
  });

  it("omits rows the upstream did not size", async () => {
    upstream({ credits: { body: { credits: {}, windowLimits: { fiveHour: { used: 1 }, weekly: { used: 1, cap: 4 } } } } });
    const out = await getCommandCodeUsage("user_fixture");

    expect(Object.keys(out.quotas)).toEqual(["Weekly"]);
  });

  it.each([401, 403])("reports a rejected key on HTTP %s without echoing the upstream body", async (status) => {
    upstream({ credits: { status, text: "upstream-secret-detail" } });
    const out = await getCommandCodeUsage("user_fixture");

    expect(out.quotas).toBeUndefined();
    expect(out.message).toMatch(/rejected the request/);
    expect(JSON.stringify(out)).not.toContain("upstream-secret-detail");
  });

  it.each([
    ["an HTTP error", { status: 502, text: "upstream-secret-detail" }, /credits API error \(502\)/],
    ["a non-JSON body", { text: "upstream-secret-detail" }, /credits response was not JSON/],
    ["a transport error", { error: new Error("connect ECONNREFUSED") }, /credits request failed/]
  ])("reports %s from the credits read", async (_label, credits, message) => {
    upstream({ credits });
    const out = await getCommandCodeUsage("user_fixture");

    expect(out.quotas).toBeUndefined();
    expect(out.message).toMatch(message);
    expect(JSON.stringify(out)).not.toContain("upstream-secret-detail");
  });

  it("asks for a key without calling upstream", async () => {
    const out = await getCommandCodeUsage(null);

    expect(out.message).toMatch(/API key not available/);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
