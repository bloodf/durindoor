import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUsageStats: vi.fn(),
  getActiveRequests: vi.fn(),
  getRecentLogs: vi.fn(),
  getUsageHistory: vi.fn(),
}));

vi.mock("@/lib/db/index.js", () => mocks);
vi.mock("@/lib/dataDir", () => ({ getDataDir: () => "/data" }));
vi.mock("@/lib/db/paths", () => ({ DATA_FILE: "/data/data.sqlite" }));
vi.mock("node:fs", () => ({ default: { statSync: () => ({ size: 12345 }) } }));
vi.mock("@/shared/constants/config", () => ({ APP_CONFIG: { version: "test" } }));

const { GET } = await import("../../src/app/api/monitoring/route.js");

/**
 * /api/monitoring aggregates already-recorded usage data for the Monitoring
 * page and MonitoringStrip. Three behaviors here were wrong in the upstream
 * PR against this fork's DB shapes and are pinned down explicitly:
 *   1. getActiveRequests() returns { activeRequests, ... }, not a bare array.
 *   2. Success rate must come from real per-request status, not a byProvider
 *      field this fork's getUsageStats() never populates.
 *   3. getUsageHistory() calls must be time-bounded, not a full table scan.
 */
describe("GET /api/monitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUsageStats.mockResolvedValue({
      totalRequests: 10, totalPromptTokens: 100, totalCompletionTokens: 50,
      totalCachedTokens: 0, totalCost: 0.5,
      byProvider: { openai: { requests: 6, cost: 0.3 }, anthropic: { requests: 4, cost: 0.2 } },
      byModel: { "gpt-5": { requests: 10 } },
    });
    mocks.getActiveRequests.mockResolvedValue({
      activeRequests: [{ model: "gpt-5", provider: "openai", account: "acct-1", count: 2 }],
      activeSessions: [],
      recentRequests: [],
      errorProvider: "openai",
      pending: { byModel: {}, byAccount: {}, byKey: {} },
    });
    mocks.getRecentLogs.mockResolvedValue([]);
    mocks.getUsageHistory.mockResolvedValue([]);
  });

  it("reads the in-flight list from activeRequests.activeRequests, not the object itself", async () => {
    const res = await GET();
    const json = await res.json();

    expect(json.runtime.activeDetail).toEqual([
      { model: "gpt-5", provider: "openai", account: "acct-1", count: 2 },
    ]);
    expect(json.runtime.activeRequests).toBe(2);
    // "pending" reflects the same in-flight total, not the raw tracker object.
    expect(json.runtime.pending).toBe(2);
    expect(json.runtime.errorProvider).toBe("openai");
  });

  it("falls back to zero active requests when activeRequests.activeRequests is missing", async () => {
    mocks.getActiveRequests.mockResolvedValue({ activeRequests: undefined });
    const res = await GET();
    const json = await res.json();
    expect(json.runtime.activeDetail).toEqual([]);
    expect(json.runtime.activeRequests).toBe(0);
  });

  it("computes success rate from real usageHistory rows, not a nonexistent byProvider field", async () => {
    mocks.getUsageHistory.mockResolvedValue([
      { provider: "openai", status: "ok", timestamp: "01-01-2026 00:00:00" },
      { provider: "openai", status: "error", timestamp: "01-01-2026 00:01:00" },
      { provider: "anthropic", status: "200", timestamp: "01-01-2026 00:02:00" },
      { provider: "anthropic", status: "", timestamp: "01-01-2026 00:03:00" },
    ]);
    const res = await GET();
    const json = await res.json();
    // 3 of 4 rows succeed -> 75%, proving the number reflects real rows and
    // is not permanently 100% from an absent error field.
    expect(json.activity.successRate).toBe(75);
  });

  it("reports null success rate when there is no history to measure", async () => {
    mocks.getUsageHistory.mockResolvedValue([]);
    const res = await GET();
    const json = await res.json();
    expect(json.activity.successRate).toBeNull();
  });

  it("bounds every getUsageHistory() call with a startDate instead of scanning the whole table", async () => {
    await GET();
    expect(mocks.getUsageHistory).toHaveBeenCalledTimes(2);
    for (const call of mocks.getUsageHistory.mock.calls) {
      const [filter] = call;
      expect(filter).toHaveProperty("startDate");
      expect(typeof filter.startDate).toBe("string");
      expect(new Date(filter.startDate).getTime()).not.toBeNaN();
      expect(new Date(filter.startDate).getTime()).toBeLessThan(Date.now());
    }
  });

  it("derives per-provider health from byProvider requests plus history-based error counts", async () => {
    mocks.getUsageHistory.mockResolvedValue([
      { provider: "openai", status: "error", timestamp: "01-01-2026 00:00:00" },
    ]);
    const res = await GET();
    const json = await res.json();
    const openai = json.health.find((p) => p.id === "openai");
    expect(openai).toMatchObject({ requests: 6, errors: 1 });
    expect(openai.successRate).toBeCloseTo((5 / 6) * 100, 1);
  });

  it("parses getRecentLogs() pipe-delimited lines into structured entries", async () => {
    mocks.getRecentLogs.mockResolvedValue([
      "01-01-2026 00:00:00 | gpt-5 | OPENAI | acct-1 | 10 | 5 | ok",
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.activity.recent[0]).toMatchObject({
      timestamp: "01-01-2026 00:00:00",
      model: "gpt-5",
      provider: "OPENAI",
      account: "acct-1",
      promptTokens: "10",
      completionTokens: "5",
      status: "ok",
    });
  });

  it("never throws when every data source fails", async () => {
    mocks.getUsageStats.mockRejectedValue(new Error("db down"));
    mocks.getActiveRequests.mockRejectedValue(new Error("db down"));
    mocks.getRecentLogs.mockRejectedValue(new Error("db down"));
    mocks.getUsageHistory.mockRejectedValue(new Error("db down"));

    const res = await GET();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.runtime.activeRequests).toBe(0);
    expect(json.activity.successRate).toBeNull();
    expect(json.health).toEqual([]);
  });
});
