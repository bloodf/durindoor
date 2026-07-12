import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestDetails: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
}));
vi.mock("@/lib/usageDb", () => mocks);

const route = await import("../../src/app/api/usage/request-details/route.js");

function request(params = {}) {
  const query = new URLSearchParams(params).toString();
  return new Request(`http://localhost/api/usage/request-details${query ? `?${query}` : ""}`);
}

describe("request-details page/pageSize validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestDetails.mockResolvedValue({ details: [], pagination: {} });
  });

  it.each(["abc", "0", "101", "1.5", "-1"])("rejects pageSize=%j with 400", async (pageSize) => {
    const res = await route.GET(request({ pageSize }));
    expect(res.status).toBe(400);
    expect(mocks.getRequestDetails).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "1.5", "-1"])("rejects page=%j with 400", async (page) => {
    const res = await route.GET(request({ page }));
    expect(res.status).toBe(400);
    expect(mocks.getRequestDetails).not.toHaveBeenCalled();
  });

  it("accepts pageSize=50", async () => {
    const res = await route.GET(request({ pageSize: "50" }));
    expect(res.status).toBe(200);
    expect(mocks.getRequestDetails).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 50 })
    );
  });

  it("defaults pageSize to 20 when omitted", async () => {
    const res = await route.GET(request());
    expect(res.status).toBe(200);
    expect(mocks.getRequestDetails).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 })
    );
  });

  it("accepts page=3", async () => {
    const res = await route.GET(request({ page: "3" }));
    expect(res.status).toBe(200);
    expect(mocks.getRequestDetails).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3 })
    );
  });
});
