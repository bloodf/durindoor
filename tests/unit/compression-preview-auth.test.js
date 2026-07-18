import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyA: vi.fn(),
  applyB: vi.fn(),
}));

// Virtual mock: `open-sse/services/compression/index.js` is provided by F-1a
// (feat/compression-stack) and is NOT present on origin/dev where this route
// lands. The integrator cherry-picks this PR on top of F-1a, where the real
// module resolves; here we stub the exact contract the route depends on so the
// focused test can run in isolation.
vi.mock("open-sse/services/compression/index.js", () => ({
  ENGINE_IDS: ["engine-a", "engine-b"],
  isEngineAvailable: vi.fn((id) => id === "engine-a" || id === "engine-b"),
  getEngine: vi.fn((id) => {
    if (id === "engine-a") return { apply: mocks.applyA };
    if (id === "engine-b") return { apply: mocks.applyB };
    throw new Error(`Unknown compression engine: ${id}`);
  }),
}));

const { POST } = await import("../../src/app/api/compression/preview/route.js");

// Dashboard-context request: NO `Authorization: Bearer` and NO `x-api-key`
// header. The Test Savers page at
// `src/app/(dashboard)/dashboard/compression-studio/page.js` POSTs this way
// because `src/dashboardGuard.js:262-289` already authenticated the dashboard
// session (dashboard JWT) at the proxy layer.
function dashboardJsonRequest(body) {
  return new Request("https://durindoor.local/api/compression/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/compression/preview — dashboard-context auth (R1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyA.mockResolvedValue({
      body: { model: "x", messages: [] },
      compressed: true,
      stats: { savingsPercent: 10 },
    });
    mocks.applyB.mockResolvedValue({
      compressed: false,
      stats: null,
    });
  });

  // Regression: users with global `requireApiKey=true` (LLM-endpoint
  // enforcement) hit a 401 from this handler even though the dashboard proxy
  // had already authenticated their session. The handler must NOT re-check the
  // LLM API key — it is internal, reached only behind the dashboard proxy.
  it("returns 200, not 401, for a dashboard request with no LLM API key header", async () => {
    const res = await POST(dashboardJsonRequest({ model: "x", messages: [] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results["engine-a"].status).toBe("compressed");
    expect(json.results["engine-a"].raw).toEqual({ model: "x", messages: [] });
    expect(json.results["engine-b"].raw).toBeUndefined();
    expect(mocks.applyA).toHaveBeenCalled();
  });

  it("still returns 400 on a non-JSON body without an API key header", async () => {
    const req = new Request("https://durindoor.local/api/compression/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mocks.applyA).not.toHaveBeenCalled();
  });
});
