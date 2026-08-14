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

const sensitive = {
  id: "req-1",
  timestamp: "2026-08-14T00:00:00.000Z",
  provider: "openai",
  model: "gpt-4o",
  connectionId: "conn-1",
  status: "success",
  latencyMs: 120,
  usage: { input: 10, output: 20 },
  diagnostics: { streamChunks: 4, finishReason: "stop" },
  requestBody: { model: "gpt-4o", messages: [{ role: "user", content: "secret prompt" }] },
  providerRequestBody: { upstream: "secret upstream body" },
  providerResponseBody: { upstream: "secret upstream response" },
  responseBody: { model: "gpt-4o", choices: [{ message: { content: "secret reply" } }] },
};

describe("GET /api/usage/request-details payload redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestDetails.mockResolvedValue({ details: [sensitive], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNext: false, hasPrev: false } });
  });

  it("never returns requestBody, providerRequestBody, providerResponseBody, or responseBody to dashboard consumers", async () => {
    const res = await route.GET(request());
    const body = res.body;
    const detail = body.details[0];

    expect(res.status).toBe(200);
    expect(detail.requestBody).toBeUndefined();
    expect(detail.providerRequestBody).toBeUndefined();
    expect(detail.providerResponseBody).toBeUndefined();
    expect(detail.responseBody).toBeUndefined();
    expect(detail.id).toBe("req-1");
    expect(detail.provider).toBe("openai");
    expect(detail.model).toBe("gpt-4o");
    expect(detail.connectionId).toBe("conn-1");
    expect(detail.status).toBe("success");
    expect(detail.latencyMs).toBe(120);
    expect(detail.usage).toEqual({ input: 10, output: 20 });
    expect(detail.timestamp).toBe("2026-08-14T00:00:00.000Z");
    expect(detail.diagnostics).toEqual({ streamChunks: 4, finishReason: "stop" });
  });
});
