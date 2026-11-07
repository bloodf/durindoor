import { afterAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProviderConnections: vi.fn(), testSingleConnection: vi.fn() }));
vi.mock("@/models", () => ({ getProviderConnections: mocks.getProviderConnections }));
vi.mock("@/app/api/providers/[id]/test/testUtils.js", () => ({ testSingleConnection: mocks.testSingleConnection }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
const { POST } = await import("@/app/api/providers/test-batch/route.js");
const { testSummaryToast } = await import("@/app/(dashboard)/dashboard/providers/testSummaryToast.js");
afterAll(() => vi.unstubAllGlobals());

describe("saved connection batch tests", () => {
  it("keeps unavailable results separate from invalid credentials and passes", async () => {
    mocks.getProviderConnections.mockResolvedValue(["outage", "bad", "good"].map((id) => ({ id, provider: "wafer", authType: "apikey" })));
    mocks.testSingleConnection.mockImplementation(async (id) => ({
      outage: { valid: false, unavailable: true, error: "Provider unavailable - try again later" },
      bad: { valid: false, error: "Invalid API key" },
      good: { valid: true, error: null },
    })[id]);
    const response = await POST(new Request("http://localhost/api/providers/test-batch", { method: "POST", body: JSON.stringify({ mode: "all" }) }));
    const body = await response.json();
    expect(body.summary).toEqual({ total: 3, passed: 1, failed: 1, skipped: 0, unavailable: 1 });
    expect(body.results[0]).toMatchObject({ valid: false, unavailable: true, error: "Provider unavailable - try again later" });
    expect(body.results[1]).toMatchObject({ valid: false, unavailable: false, error: "Invalid API key" });
    expect(body.results[2]).toMatchObject({ valid: true, unavailable: false });
    expect(testSummaryToast(body.summary)).toEqual({ level: "warning", message: "1/3 passed, 1 failed, 1 unavailable" });
  });

  it("does not report all passed when every test is unavailable", () => {
    expect(testSummaryToast({ total: 1, passed: 0, failed: 0, skipped: 0, unavailable: 1 })).toEqual({ level: "warning", message: "0/1 passed, 1 unavailable" });
  });

  it("retains passed, failed and skipped summaries", () => {
    expect(testSummaryToast({ total: 2, passed: 2, failed: 0 })).toEqual({ level: "success", message: "All 2 tests passed" });
    expect(testSummaryToast({ total: 2, passed: 0, failed: 0, skipped: 2 })).toEqual({ level: "warning", message: "0/2 passed, 2 skipped" });
    expect(testSummaryToast({ total: 3, passed: 1, failed: 1, skipped: 1 })).toEqual({ level: "warning", message: "1/3 passed, 1 failed, 1 skipped" });
  });
});
