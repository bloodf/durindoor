import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  updateSettings: vi.fn(),
  invalidateDefaultPasswordCache: vi.fn(),
  resetPasswordChangeProofs: vi.fn(),
  hasTrustedLocalOrigin: vi.fn(() => true),
  isLocalRequest: vi.fn(() => true),
  consoleError: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/localDb", () => ({ updateSettings: mocks.updateSettings }));
vi.mock("@/lib/auth/dashboardSession", () => ({ invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache }));
vi.mock("@/lib/auth/requestOrigin", () => ({ hasTrustedLocalOrigin: mocks.hasTrustedLocalOrigin }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: mocks.resetPasswordChangeProofs }));

const { POST } = await import("../../src/app/api/auth/reset-password/route.js");

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasTrustedLocalOrigin.mockReturnValue(true);
    mocks.isLocalRequest.mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(mocks.consoleError);
  });

  it("redacts reset failures", async () => {
    mocks.updateSettings.mockRejectedValueOnce(new Error("SENTINEL_RESET_ERROR"));

    const response = await POST();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Password reset failed" });
    expect(mocks.consoleError).toHaveBeenCalledWith("[auth] password reset failed");
    expect(mocks.consoleError).not.toHaveBeenCalledWith(expect.stringContaining("SENTINEL_RESET_ERROR"));
  });

  it("rejects reset requests without a trusted local browser origin", async () => {
    mocks.hasTrustedLocalOrigin.mockReturnValue(false);

    const response = await POST(new Request("http://durindoor.test/api/auth/reset-password", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("resets from a trusted local browser origin", async () => {
    const response = await POST(new Request("http://localhost:20128/api/auth/reset-password", {
      method: "POST",
      headers: { host: "localhost:20128", origin: "http://localhost:20128" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledOnce();
  });
});
