import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateApiKeyAuth: vi.fn(),
  extractApiKey: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  extractApiKey: mocks.extractApiKey,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

const { GET } = await import("@/app/api/v1/realtime/auth/route.js");

describe("realtime auth bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractApiKey.mockReturnValue(null);
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true, operator: true });
  });

  it("passes the original request so CLI operator identity can be verified", async () => {
    const request = new Request("http://localhost/api/v1/realtime/auth", {
      headers: { "x-9r-cli-token": "operator" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(mocks.evaluateApiKeyAuth).toHaveBeenCalledWith(null, { required: true, request });
  });
});
