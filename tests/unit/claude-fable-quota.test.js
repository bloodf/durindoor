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

describe("Claude Fable provider-reported quota (upstream #3847)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearOAuthQuotaCacheForTesting();
  });

  it("returns actual weekly_scoped Fable usage and reset from the usage fetch", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        seven_day: { utilization: 10, resets_at: "2026-09-12T00:00:00Z" },
        limits: [{
          kind: "weekly_scoped",
          percent: 37.5,
          resets_at: "2026-09-13T04:05:06Z",
          scope: { model: { display_name: "  Fable  " } },
        }],
      })
    );

    const usage = await getClaudeUsage("fable-token-scoped", null, "oauth");
    expect(usage.quotas["weekly fable (7d)"]).toEqual({
      used: 37.5,
      total: 100,
      remaining: 62.5,
      remainingPercentage: 62.5,
      resetAt: "2026-09-13T04:05:06.000Z",
      unlimited: false,
    });
  });

  it("does not fabricate a Fable row when limits omits it", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        five_hour: { utilization: 5, resets_at: "2026-09-05T23:00:00Z" },
        seven_day: { utilization: 12, resets_at: "2026-09-12T00:00:00Z" },
        limits: [{
          kind: "weekly_scoped",
          percent: 25,
          scope: { model: { display_name: "Sonnet" } },
        }],
      })
    );

    const usage = await getClaudeUsage("fable-token-absent", null, "oauth");
    expect(usage.quotas["weekly (7d)"]).toMatchObject({ used: 12 });
    expect(usage.quotas["weekly sonnet (7d)"]).toMatchObject({ used: 25 });
    expect(usage.quotas["weekly fable (7d)"]).toBeUndefined();
  });

  it("ignores malformed and nonfinite scoped rows while clamping finite percentages", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        limits: [
          { kind: "weekly_scoped", percent: null, scope: { model: { display_name: "Null" } } },
          { kind: "weekly_scoped", percent: "45", scope: { model: { display_name: "String" } } },
          { kind: "weekly_scoped", percent: Number.NaN, scope: { model: { display_name: "NaN" } } },
          { kind: "weekly_scoped", percent: Number.POSITIVE_INFINITY, scope: { model: { display_name: "Infinity" } } },
          { kind: "weekly_scoped", percent: 20, scope: { model: { display_name: "   " } } },
          { kind: "daily_scoped", percent: 20, scope: { model: { display_name: "Daily" } } },
          { kind: "weekly_scoped", percent: -12, resets_at: "not-a-date", scope: { model: { display_name: "Lower" } } },
          { kind: "weekly_scoped", percent: 140, scope: { model: { display_name: "Upper" } } },
        ],
      }),
    });

    const usage = await getClaudeUsage("fable-token-validation", null, "oauth");
    expect(usage.quotas).toEqual({
      "weekly lower (7d)": expect.objectContaining({ used: 0, remainingPercentage: 100, resetAt: null }),
      "weekly upper (7d)": expect.objectContaining({ used: 100, remainingPercentage: 0 }),
    });
  });

  it("preserves weekly total and legitimate seven_day model windows", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        seven_day: { utilization: 10, resets_at: "2026-09-12T00:00:00Z" },
        seven_day_sonnet: { utilization: 55, resets_at: "2026-09-13T00:00:00Z" },
        seven_day_fable_5_1: { utilization: 30, resets_at: "2026-09-14T00:00:00Z" },
      })
    );

    const usage = await getClaudeUsage("fable-token-legacy", null, "oauth");
    expect(usage.quotas["weekly (7d)"]).toMatchObject({ used: 10, remainingPercentage: 90 });
    expect(usage.quotas["weekly sonnet (7d)"]).toMatchObject({ used: 55, remainingPercentage: 45 });
    expect(usage.quotas["weekly fable (7d)"]).toMatchObject({ used: 30, remainingPercentage: 70 });
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
