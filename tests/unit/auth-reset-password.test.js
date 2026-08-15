import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  updateSettings: vi.fn(),
  invalidateDefaultPasswordCache: vi.fn(),
  resetPasswordChangeProofs: vi.fn(),
  consoleError: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/localDb", () => ({ updateSettings: mocks.updateSettings }));
vi.mock("@/lib/auth/dashboardSession", () => ({ invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache }));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: mocks.resetPasswordChangeProofs }));

const { POST } = await import("../../src/app/api/auth/reset-password/route.js");

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
