import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveClientApiKey: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: mocks.resolveClientApiKey,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

const { GET } = await import("@/app/api/v1/realtime/auth/route.js");

describe("realtime auth bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.resolveClientApiKey.mockResolvedValue({ apiKey: null, auth: { ok: true, operator: true } });
  });

  it("passes the original request so CLI operator identity can be verified", async () => {
    const request = new Request("http://localhost/api/v1/realtime/auth", {
      headers: { "x-9r-cli-token": "operator" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(mocks.resolveClientApiKey).toHaveBeenCalledWith(request, { required: true });
  });
});
