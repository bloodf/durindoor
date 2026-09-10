import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  getClaudeUsage,
  __clearOAuthQuotaCacheForTesting,
} from "../../open-sse/services/usage/claude.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Claude Fable quota tracker (upstream e214fb1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearOAuthQuotaCacheForTesting();
  });

  it("normalizes seven_day_fable_5_1 / seven_day_fable_5 windows to weekly fable (7d)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        seven_day: { utilization: 10, resets_at: "2026-09-12T00:00:00Z" },
        seven_day_fable_5_1: { utilization: 30, resets_at: "2026-09-12T00:00:00Z" },
      })
    );

    const usage = await getClaudeUsage("fable-token-5-1", null, "oauth");
    expect(usage.quotas["weekly fable (7d)"]).toMatchObject({
      used: 30,
      total: 100,
      remaining: 70,
      remainingPercentage: 70,
      unlimited: false,
    });

    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        seven_day: { utilization: 10, resets_at: "2026-09-12T00:00:00Z" },
        seven_day_fable_5: { utilization: 55, resets_at: "2026-09-12T00:00:00Z" },
      })
    );

    const usage2 = await getClaudeUsage("fable-token-5", null, "oauth");
    expect(usage2.quotas["weekly fable (7d)"]).toMatchObject({
      used: 55,
      remainingPercentage: 45,
    });
  });

  it("accepts a bare fable / fable_5_1 payload key as the weekly fable window", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        seven_day: { utilization: 10, resets_at: "2026-09-12T00:00:00Z" },
        fable_5_1: { utilization: 80, resets_at: "2026-09-12T00:00:00Z" },
      })
    );

    const usage = await getClaudeUsage("fable-token-bare", null, "oauth");
    expect(usage.quotas["weekly fable (7d)"]).toMatchObject({
      used: 80,
      remainingPercentage: 20,
    });
  });

  it("falls back to a 100%-available weekly fable window when the payload omits Fable", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        five_hour: { utilization: 5, resets_at: "2026-09-05T23:00:00Z" },
        seven_day: { utilization: 12, resets_at: "2026-09-12T00:00:00Z" },
      })
    );

    const usage = await getClaudeUsage("fable-token-fallback", null, "oauth");
    expect(usage.quotas["weekly (7d)"]).toMatchObject({ used: 12 });
    expect(usage.quotas["weekly fable (7d)"]).toMatchObject({
      used: 0,
      total: 100,
      remaining: 100,
      remainingPercentage: 100,
      unlimited: false,
    });
    expect(usage.quotas["weekly fable (7d)"].resetAt).toBeTruthy();
  });

  it("does not inject the fallback row when no weekly window exists at all", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        five_hour: { utilization: 5, resets_at: "2026-09-05T23:00:00Z" },
      })
    );

    const usage = await getClaudeUsage("fable-token-no-weekly", null, "oauth");
    expect(usage.quotas["weekly fable (7d)"]).toBeUndefined();
  });

  it("orders Claude quota rows in the canonical Quota Tracker order", () => {
    const data = {
      quotas: {
        "weekly sonnet (7d)": { used: 10, total: 100 },
        "weekly fable (7d)": { used: 0, total: 100 },
        "session (5h)": { used: 1, total: 100 },
        "weekly (7d)": { used: 2, total: 100 },
        "weekly opus (7d)": { used: 3, total: 100 },
      },
    };

    const quotas = parseQuotaData("claude", data);
    expect(quotas.map((q) => q.name)).toEqual([
      "session (5h)",
      "weekly (7d)",
      "weekly fable (7d)",
      "weekly opus (7d)",
      "weekly sonnet (7d)",
    ]);
  });

  it("keeps unknown Claude quota rows after the canonical ones", () => {
    const data = {
      quotas: {
        "weekly mystery (7d)": { used: 1, total: 100 },
        "session (5h)": { used: 1, total: 100 },
      },
    };

    const quotas = parseQuotaData("claude", data);
    expect(quotas.map((q) => q.name)).toEqual(["session (5h)", "weekly mystery (7d)"]);
  });
});
