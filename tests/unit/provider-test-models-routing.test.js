import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
  isOperatorRequest: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: mocks.isOperatorRequest,
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const originalFetch = global.fetch;

describe("provider test-models route kind routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-hf",
      provider: "huggingface",
    });
    mocks.getApiKeys.mockResolvedValue([{ key: "sk-internal", isActive: true }]);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.isOperatorRequest.mockResolvedValue(true);
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/api/v1/images/generations")) {
        return Promise.resolve(new Response(JSON.stringify({
          created: 1,
          data: [{ b64_json: "abc" }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("routes huggingface image models to /api/v1/images/generations", async () => {
    const { POST } = await import("../../src/app/api/providers/[id]/test-models/route.js");

    const req = new Request("http://localhost/api/providers/conn-hf/test-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: Promise.resolve({ id: "conn-hf" }) });
    const body = await res.json();

    expect(body.provider).toBe("huggingface");
    expect(body.results.some((r) => r.modelId === "black-forest-labs/FLUX.1-schnell" && r.ok)).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/images/generations"),
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("pins every probe to the URL connection id", async () => {
    const { POST } = await import("../../src/app/api/providers/[id]/test-models/route.js");
    await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: "conn-hf" }) });
    expect(global.fetch.mock.calls.length).toBeGreaterThan(0);
    for (const call of global.fetch.mock.calls) expect(call[1].headers["x-connection-id"]).toBe("conn-hf");
  });

  it("rejects non-operators with 403 and sends no probe", async () => {
    mocks.isOperatorRequest.mockResolvedValue(false);
    const { POST } = await import("../../src/app/api/providers/[id]/test-models/route.js");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: "conn-hf" }) });
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
