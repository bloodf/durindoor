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
  latency: { totalMs: 120 },
  tokens: { input: 10, output: 20 },
  pxpipe: { applied: true },
  request: { model: "gpt-4o", messages: [{ role: "user", content: "secret prompt" }] },
  providerRequest: { upstream: "secret upstream body" },
  providerResponse: { upstream: "secret upstream response" },
  response: { model: "gpt-4o", choices: [{ message: { content: "secret reply" } }] },
};

describe("GET /api/usage/request-details payload redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestDetails.mockResolvedValue({ details: [sensitive], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNext: false, hasPrev: false } });
  });

  it("returns only stable redaction metadata for former payload fields", async () => {
    const res = await route.GET(request());
    const body = res.body;
    const detail = body.details[0];

    expect(res.status).toBe(200);
    const expectedBytes = {
      request: Buffer.byteLength(JSON.stringify(sensitive.request)),
      providerRequest: Buffer.byteLength(JSON.stringify(sensitive.providerRequest)),
      providerResponse: Buffer.byteLength(JSON.stringify(sensitive.providerResponse)),
      response: Buffer.byteLength(JSON.stringify(sensitive.response)),
    };
    for (const field of ["request", "providerRequest", "providerResponse", "response"]) {
      expect(detail[field]).toEqual({ redacted: true, version: 1, present: true, type: "object" });
      expect(detail[field]).not.toHaveProperty("bytes");
      expect(expectedBytes[field]).toBeGreaterThan(0);
    }
    expect(JSON.stringify(detail)).not.toMatch(/secret prompt|secret upstream body|secret upstream response|secret reply/);
    expect(detail.id).toBe("req-1");
    expect(detail.provider).toBe("openai");
    expect(detail.model).toBe("gpt-4o");
    expect(detail.connectionId).toBe("conn-1");
    expect(detail.status).toBe("success");
    expect(detail.latency).toEqual({ totalMs: 120 });
    expect(detail.tokens).toEqual({ input: 10, output: 20 });
    expect(detail.pxpipe).toEqual({ applied: true });
    expect(detail.timestamp).toBe("2026-08-14T00:00:00.000Z");
  });

  it("passes through validated stored metadata without exposing extra stored keys", async () => {
    mocks.getRequestDetails.mockResolvedValue({
      details: [{ ...sensitive, request: { redacted: true, version: 1, present: true, type: "object", bytes: 123, preview: "RAW-CANARY" } }],
      pagination: {},
    });

    const detail = (await route.GET(request())).body.details[0];
    expect(detail.request).toEqual({ redacted: true, version: 1, present: true, type: "object", bytes: 123 });
    expect(JSON.stringify(detail)).not.toContain("RAW-CANARY");
  });
});
