import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUsageStats: vi.fn(),
  getChartData: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
}));
vi.mock("@/lib/usageDb", () => mocks);

const statsRoute = await import("../../src/app/api/usage/stats/route.js");
const chartRoute = await import("../../src/app/api/usage/chart/route.js");
const periods = ["today", "24h", "7d", "30d", "60d", "90d", "180d", "365d", "all"];

function request(route, period) {
  const suffix = period === undefined ? "" : `?period=${encodeURIComponent(period)}`;
  return new Request(`http://localhost/api/usage/${route}${suffix}`);
}

describe("usage period API validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUsageStats.mockResolvedValue({ ok: true });
    mocks.getChartData.mockResolvedValue([]);
  });

  it.each(periods)("accepts %s in both stats and chart routes", async (period) => {
    expect((await statsRoute.GET(request("stats", period))).status).toBe(200);
    expect((await chartRoute.GET(request("chart", period))).status).toBe(200);
    expect(mocks.getUsageStats).toHaveBeenCalledWith(period);
    expect(mocks.getChartData).toHaveBeenCalledWith(period);
  });

  it("defaults a missing period to 7d", async () => {
    await statsRoute.GET(request("stats"));
    await chartRoute.GET(request("chart"));
    expect(mocks.getUsageStats).toHaveBeenCalledWith("7d");
    expect(mocks.getChartData).toHaveBeenCalledWith("7d");
  });

  it("defaults an empty period to 7d", async () => {
    await statsRoute.GET(request("stats", ""));
    await chartRoute.GET(request("chart", ""));
    expect(mocks.getUsageStats).toHaveBeenCalledWith("7d");
    expect(mocks.getChartData).toHaveBeenCalledWith("7d");
  });

  it.each([" 90d", "90D", "unknown", "all "])("rejects invalid value %j before repository access", async (period) => {
    expect((await statsRoute.GET(request("stats", period))).status).toBe(400);
    expect((await chartRoute.GET(request("chart", period))).status).toBe(400);
    expect(mocks.getUsageStats).not.toHaveBeenCalled();
    expect(mocks.getChartData).not.toHaveBeenCalled();
  });
});
