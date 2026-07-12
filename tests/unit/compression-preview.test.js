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
  ENGINE_IDS: ["engine-a", "engine-b", "engine-missing"],
  isEngineAvailable: vi.fn((id) => id === "engine-a" || id === "engine-b"),
  getEngine: vi.fn((id) => {
    if (id === "engine-a") return { apply: mocks.applyA };
    if (id === "engine-b") return { apply: mocks.applyB };
    throw new Error(`Unknown compression engine: ${id}`);
  }),
}));

const { POST } = await import("../../src/app/api/compression/preview/route.js");

function jsonRequest(body) {
  return new Request("https://durindoor.local/api/compression/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/compression/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns every catalog id with compressed + savingsPercent", async () => {
    // engine-a: engine reports stats.savingsPercent directly (preferred source).
    mocks.applyA.mockResolvedValue({
      body: { model: "x", messages: [] },
      compressed: true,
      stats: { savingsPercent: 42.5 },
    });
    // engine-b: no savingsPercent on stats — route must fall back to the
    // bytesBefore/bytesAfter fields. Regression guard: if the route hard-codes
    // stats.savingsPercent, this resolves to 0 and the assertion fails.
    mocks.applyB.mockResolvedValue({
      body: { model: "x", messages: [] },
      compressed: true,
      stats: { bytesBefore: 1000, bytesAfter: 250 },
    });

    const res = await POST(jsonRequest({ model: "x", messages: [] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.engines).toEqual(["engine-a", "engine-b", "engine-missing"]);
    expect(json.results).toEqual({
      "engine-a": { status: "compressed", compressed: true, savingsPercent: 42.5 },
      "engine-b": { status: "compressed", compressed: true, savingsPercent: 75 },
      "engine-missing": { status: "unavailable" },
    });
    expect(mocks.applyA).toHaveBeenCalledWith({ model: "x", messages: [] }, {});
    expect(mocks.applyB).toHaveBeenCalledWith({ model: "x", messages: [] }, {});
  });

  it("labels an available engine that throws as error, not unavailable", async () => {
    mocks.applyA.mockRejectedValue(new Error("boom"));
    mocks.applyB.mockResolvedValue({ body: {}, compressed: false, stats: null });

    const json = await (await POST(jsonRequest({}))).json();

    expect(json.results["engine-a"]).toEqual({ status: "error" });
    expect(json.results["engine-missing"]).toEqual({ status: "unavailable" });
  });

  it("reports unchanged status and zero savings when an engine does not change the body", async () => {
    mocks.applyA.mockResolvedValue({ body: {}, compressed: false, stats: null });
    mocks.applyB.mockResolvedValue({ body: {}, compressed: false, stats: null });

    const json = await (await POST(jsonRequest({}))).json();

    expect(json.results["engine-a"]).toEqual({ status: "unchanged", compressed: false, savingsPercent: 0 });
    expect(json.results["engine-b"]).toEqual({ status: "unchanged", compressed: false, savingsPercent: 0 });
  });

  it("returns 200 without an API key header (dashboard proxy already authenticated)", async () => {
    mocks.applyA.mockResolvedValue({ body: {}, compressed: false, stats: null });
    mocks.applyB.mockResolvedValue({ body: {}, compressed: false, stats: null });

    const req = new Request("https://durindoor.local/api/compression/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
  });

  it("returns 400 on a non-JSON body", async () => {
    const req = new Request("https://durindoor.local/api/compression/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
      body: "not json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mocks.applyA).not.toHaveBeenCalled();
  });
});
