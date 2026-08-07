import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.fn(async (url) => ({
  ok: true,
  status: 200,
  json: async () => url.includes(":loadCodeAssist")
    ? { cloudaicompanionProject: "project-1", currentTier: { name: "Pro" } }
    : {
        models: {
          "gemini-3.6-flash-high": {
            displayName: "Gemini 3.6 Flash (High)",
            quotaInfo: { remainingFraction: 0.8, resetTime: "2026-07-25T12:00:00Z" },
          },
          "gemini-3.6-flash-medium": {
            displayName: "Gemini 3.6 Flash (Medium)",
            quotaInfo: { remainingFraction: 0.5, resetTime: "2026-07-25T12:00:00Z" },
          },
          "gemini-3.6-flash-low": {
            displayName: "Gemini 3.6 Flash (Low)",
            quotaInfo: { remainingFraction: 0.2, resetTime: "2026-07-25T12:00:00Z" },
          },
          "gemini-3.5-flash-low": {
            displayName: "Gemini 3.5 Flash (Medium)",
            quotaInfo: { remainingFraction: 0.9, resetTime: "2026-07-25T12:00:00Z" },
          },
          "internal-model": {
            displayName: "Internal",
            isInternal: true,
            quotaInfo: { remainingFraction: 0.5 },
          },
          "non-important-model": {
            displayName: "Non-important",
            quotaInfo: { remainingFraction: 0.5 },
          },
        },
      },
  text: async () => "{}",
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

describe("Antigravity quota tracker: Gemini 3.6 Flash", () => {
  beforeEach(() => proxyAwareFetch.mockClear());

  it("returns all Gemini 3.6 Flash tiers with display and usage data", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.quotas["gemini-3.6-flash-high"]).toMatchObject({
      used: 200,
      total: 1000,
      remainingPercentage: 80,
      displayName: "Gemini 3.6 Flash (High)",
    });
    expect(usage.quotas["gemini-3.6-flash-medium"]).toMatchObject({
      used: 500,
      total: 1000,
      remainingPercentage: 50,
      displayName: "Gemini 3.6 Flash (Medium)",
    });
    expect(usage.quotas["gemini-3.6-flash-low"]).toMatchObject({
      used: 800,
      total: 1000,
      remainingPercentage: 20,
      displayName: "Gemini 3.6 Flash (Low)",
    });
  });

  it("keeps internal and non-important models filtered", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.quotas).not.toHaveProperty("internal-model");
    expect(usage.quotas).not.toHaveProperty("non-important-model");
    expect(Object.keys(usage.quotas)).toEqual([
      "gemini-3.6-flash-high",
      "gemini-3.6-flash-medium",
      "gemini-3.6-flash-low",
      "gemini-3.5-flash-low",
    ]);
  });
});
