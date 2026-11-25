import { describe, it, expect, vi, beforeEach } from "vitest";

const proxyAwareFetch = vi.fn();
proxyAwareFetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const { getAntigravityUsage, parseAntigravityWeeklyQuotas } = await import("../../open-sse/services/usage/google.js");

const MODEL = "gemini-4-hydrogen-xhigh";
const RESET = "2026-12-01T00:00:00Z";

function mockNetwork({ remainingFraction, resetTime = RESET, weeklyGroups = [] } = {}) {
  proxyAwareFetch.mockImplementation(async (url) => {
    if (typeof url !== "string") return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
    if (url.includes(":loadCodeAssist")) {
      return { ok: true, status: 200, json: async () => ({ currentTier: { name: "Pro" }, paidTier: { id: "g1-pro-tier" } }), text: async () => "{}" };
    }
    if (url.includes("retrieveUserQuotaSummary")) {
      return { ok: true, status: 200, json: async () => ({ groups: weeklyGroups }), text: async () => "{}" };
    }
    const quotaInfo = {};
    if (remainingFraction !== undefined) quotaInfo.remainingFraction = remainingFraction;
    if (resetTime !== undefined) quotaInfo.resetTime = resetTime;
    return { ok: true, status: 200, json: async () => ({ models: { [MODEL]: { quotaInfo } } }), text: async () => "{}" };
  });
}

describe("OmniRoute #2700 legacy Antigravity displayed quota fraction", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it.each([
    [-0.5, 0],
    [1.5, 100],
    [0.4, 40],
  ])("bounds only the displayed percentage for fraction %s", async (fraction, percentage) => {
    mockNetwork({ remainingFraction: fraction });
    const result = await getAntigravityUsage("offline-token", {});
    expect(result.quotas[MODEL].remainingPercentage).toBe(percentage);
    // The raw fraction still drives the legacy count fields.
    expect(result.quotas[MODEL].used).toBe(1000 - Math.round(1000 * fraction));
    expect(result.quotas[MODEL].total).toBe(1000);
  });

  it("preserves absent quota data as exhausted", async () => {
    mockNetwork({});
    const result = await getAntigravityUsage("offline-token-absent", {});
    expect(result.quotas[MODEL]).toMatchObject({ remainingPercentage: 0, used: 1000, total: 1000, unlimited: false });
  });

  it("preserves unlimited legacy values and reset metadata", async () => {
    mockNetwork({ remainingFraction: 1, resetTime: null });
    const unlimited = await getAntigravityUsage("offline-token-unlimited", {});
    expect(unlimited.quotas[MODEL]).toMatchObject({ remainingPercentage: 100, used: 0, total: 1000, unlimited: false, resetAt: null });

    mockNetwork({ remainingFraction: 0.4, resetTime: RESET });
    const reset = await getAntigravityUsage("offline-token-reset", {});
    expect(reset.quotas[MODEL].resetAt).toBe("2026-12-01T00:00:00.000Z");
    expect(reset.quotas[MODEL].remainingPercentage).toBe(40);
  });

  it("retains the grouped parser clamp and unlimited classification", () => {
    const grouped = parseAntigravityWeeklyQuotas({ groups: [{ displayName: "Gemini Models", buckets: [
      { bucketId: "weekly", window: "weekly", remainingFraction: 1.5 },
      { bucketId: "5h", window: "5h", remainingFraction: 1 },
    ] }] });
    expect(grouped.gemini_weekly).toMatchObject({ remainingPercentage: 100, unlimited: true, used: 0, total: 0 });
    expect(grouped.gemini_session).toMatchObject({ remainingPercentage: 100, unlimited: true, used: 0, total: 0 });
  });

  it.each([
    [-0.5, 600, 40, "2026-12-02T00:00:00.000Z"],
    [0, 1000, 0, "2026-12-01T00:00:00.000Z"],
  ])("reconciles a positive session using the original fraction %s", async (fraction, used, percentage, resetAt) => {
    mockNetwork({ remainingFraction: fraction, weeklyGroups: [{ displayName: "Gemini Models", buckets: [
      { bucketId: "5h", window: "5h", remainingFraction: 0.4, resetTime: "2026-12-02T00:00:00Z" },
    ] }] });
    const result = await getAntigravityUsage(`offline-token-session-${fraction}`, { projectId: "offline-project" });
    expect(result.quotas[MODEL].remainingPercentage).toBe(0);
    expect(result.quotas.gemini_session).toMatchObject({ used, total: 1000, remainingPercentage: percentage, resetAt });
  });
});
