import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
const { parseQuotaData, isQuotaCollectionDepleted } = await import("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
const { default: QuotaTable } = await import("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js");

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const window = (range, requestCount, usd) => ({ range, totals: { request_count: requestCount, usage_usd: usd }, buckets: [] });

function upstream({ plan, week, month }) {
  proxyAwareFetch.mockImplementation(async (url) => {
    if (url === "https://ollama.com/api/me") return json({ Plan: plan });
    if (url === "https://ollama.com/api/usage") return json(week);
    if (url === "https://ollama.com/api/usage?range=30d") return month ? json(month) : json({}, 500);
    throw new Error(`unexpected URL ${url}`);
  });
}

const read = () => getUsageForProvider({ provider: "ollama", apiKey: "test-key", providerSpecificData: {} });

describe("upstream PR #4688: Ollama per-token pricing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports 7 and 30 day spend plus an estimated plan pool", async () => {
    upstream({ plan: "pro", week: window("7d", 11645, 40.32), month: window("30d", 11826, 42.8) });

    const usage = await read();

    expect(Object.keys(usage.quotas)).toEqual(["Included usage (Pro · est.)", "Spent (7d)", "Spent (30d)"]);
    expect(usage.quotas["Included usage (Pro · est.)"]).toMatchObject({ used: 42.8, total: 60, remainingPercentage: 29, isEstimate: true, resetAt: null });
    expect(usage.quotas["Spent (7d)"]).toMatchObject({ total: 40.32, requestCount: 11645, isSpend: true, currency: "USD" });
    expect(usage.quotas["Spent (7d)"].remainingPercentage).toBeUndefined();
    // The default window is reused, so only the 30 day window is fetched again.
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("keeps the 7 day row and skips the estimate when the 30 day read fails", async () => {
    upstream({ plan: "pro", week: window("7d", 42, 0), month: null });

    const usage = await read();

    expect(Object.keys(usage.quotas)).toEqual(["Spent (7d)"]);
    expect(usage.quotas["Spent (7d)"]).toMatchObject({ total: 0, requestCount: 42 });
  });

  it("reports no usage for empty windows", async () => {
    upstream({ plan: "free", week: window("7d", 0, 0), month: window("30d", 0, 0) });

    const usage = await read();

    expect(usage.quotas).toEqual({});
    expect(usage.message).toMatch(/no usage reported/i);
  });

  it("renders spend without a bar or percentage and never marks it or the estimate depleted", () => {
    const rows = parseQuotaData("ollama", { quotas: {
      "Spent (7d)": { used: 0, total: 40.32, requestCount: 12, isSpend: true, currency: "USD" },
    } });
    const html = renderToStaticMarkup(React.createElement(QuotaTable, { quotas: rows }));

    expect(html).toContain("40.32 USD spent · 12 req");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("%");

    const spentOut = parseQuotaData("ollama", { quotas: {
      "Included usage (Pro · est.)": { used: 75, total: 60, remainingPercentage: 0, isEstimate: true },
      "Spent (30d)": { used: 0, total: 75, requestCount: 9, isSpend: true, currency: "USD" },
    } });
    expect(isQuotaCollectionDepleted(spentOut)).toBe(false);
  });
});
