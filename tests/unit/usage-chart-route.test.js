import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getChartData: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "content-type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/usageDb", () => ({
  getChartData: mocks.getChartData,
}));

import { GET } from "@/app/api/usage/chart/route.js";

describe("GET /api/usage/chart", () => {
  beforeEach(() => {
    mocks.getChartData.mockReset();
    mocks.getChartData.mockResolvedValue([{ label: "Apr 12", tokens: 10, cost: 0.01 }]);
  });

  it("accepts the dashboard's 90-day chart period", async () => {
    const response = await GET(new Request("http://localhost/api/usage/chart?period=90d"));

    expect(response.status).toBe(200);
    expect(mocks.getChartData).toHaveBeenCalledWith("90d");
    expect(await response.json()).toEqual([{ label: "Apr 12", tokens: 10, cost: 0.01 }]);
  });
});
