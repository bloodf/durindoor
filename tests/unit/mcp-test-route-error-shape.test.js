import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks shared between `next/server` and the gateway internals so the
// route can be exercised without spinning up Next.js or real network/stdio
// transports.
const mocks = vi.hoisted(() => ({
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status ?? 200,
    body,
  })),
  getInstanceById: vi.fn(),
  listTools: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: mocks.jsonResponse,
  },
}));

vi.mock("@/lib/localDb", () => ({
  getInstanceById: mocks.getInstanceById,
}));

vi.mock("@/lib/mcp/gateway/client", () => ({
  clientFor: vi.fn(() => ({ listTools: mocks.listTools })),
}));

// Import after mocks are set up.
const { POST } = await import("../../src/app/api/mcp-gateway/instances/[id]/test/route");

function makeContext(id) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/mcp-gateway/instances/[id]/test error shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 502 + { error, ok: false } on upstream connect/init failure", async () => {
    mocks.getInstanceById.mockResolvedValue({
      id: "inst-1",
      slug: "alpha",
      transport: "http",
      url: "http://127.0.0.1:59999/mcp",
    });
    mocks.listTools.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:59999"));

    const res = await POST({}, makeContext("inst-1"));

    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toContain("ECONNREFUSED");
  });

  it("returns 404 + { error: 'instance not found', ok: false } on unknown id", async () => {
    mocks.getInstanceById.mockResolvedValue(null);

    const res = await POST({}, makeContext("nope"));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "instance not found", ok: false });
  });

  it("success payload unchanged: 200 { ok: true, toolCount, sample }", async () => {
    mocks.getInstanceById.mockResolvedValue({
      id: "inst-2",
      slug: "beta",
      transport: "http",
      url: "http://localhost:4000/mcp",
    });
    mocks.listTools.mockResolvedValue([
      { name: "alpha", description: "first" },
      { name: "beta", description: "" },
    ]);

    const res = await POST({}, makeContext("inst-2"));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.toolCount).toBe(2);
    expect(Array.isArray(res.body.sample)).toBe(true);
    expect(res.body.sample[0]).toEqual({ name: "alpha", description: "first" });
  });
});
