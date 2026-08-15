import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  reservePasswordChangeProof: vi.fn(),
  commitPasswordChangeProof: vi.fn(),
  releasePasswordChangeProof: vi.fn(),
  resetPasswordChangeProofs: vi.fn(),
  getClientIp: vi.fn(),
  genSalt: vi.fn(),
  hash: vi.fn(),
  updateSettings: vi.fn(),
  DEFAULT_PASSWORD: "123456",
  invalidateDefaultPasswordCache: vi.fn(),
  cookies: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  validateDashboardPassword: vi.fn((password) => {
    if (typeof password !== "string" || password.length < 6) return "Password must be at least 6 characters";
    return password === "123456" ? "Password must not use the built-in default" : null;
  }),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/auth/passwordChangeProof", () => ({
  reservePasswordChangeProof: mocks.reservePasswordChangeProof,
  commitPasswordChangeProof: mocks.commitPasswordChangeProof,
  resetPasswordChangeProofs: mocks.resetPasswordChangeProofs,
  releasePasswordChangeProof: mocks.releasePasswordChangeProof,
}));
vi.mock("@/lib/auth/loginLimiter", () => ({ getClientIp: mocks.getClientIp }));
vi.mock("bcryptjs", () => ({ default: { genSalt: mocks.genSalt, hash: mocks.hash } }));
vi.mock("@/lib/localDb", () => ({ updateSettings: mocks.updateSettings }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: mocks.DEFAULT_PASSWORD,
  invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache,
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
  validateDashboardPassword: mocks.validateDashboardPassword,
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

const { POST } = await import("../../src/app/api/auth/change-password/route.js");

function request(body) {
  return new Request("http://durindoor.test/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientIp.mockReturnValue("198.51.100.4");
    mocks.genSalt.mockResolvedValue("salt");
    mocks.hash.mockResolvedValue("new-hash");
    mocks.reservePasswordChangeProof.mockReturnValue({ clientIp: "198.51.100.4" });
    mocks.updateSettings.mockResolvedValue({ password: "new-hash" });
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
  });

  it("rejects a missing or invalid flow proof before changing password", async () => {
    const missing = await POST(request({ newPassword: "long-enough-password" }));
    expect(missing.status).toBe(403);
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    mocks.reservePasswordChangeProof.mockReturnValue(null);
    const invalid = await POST(request({ proof: "wrong", newPassword: "long-enough-password" }));
    expect(invalid.status).toBe(403);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects an empty replacement password", async () => {
    const response = await POST(request({ proof: "proof", newPassword: "" }));
    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects the built-in default before reserving a proof", async () => {
    const response = await POST(request({ proof: "proof", newPassword: mocks.DEFAULT_PASSWORD }));

    expect(response.status).toBe(400);
    expect(mocks.reservePasswordChangeProof).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("releases a reserved proof when password persistence fails", async () => {
    mocks.updateSettings.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(response.status).toBe(500);
    expect(mocks.reservePasswordChangeProof).toHaveBeenCalledWith("proof", "198.51.100.4");
    expect(mocks.releasePasswordChangeProof).toHaveBeenCalledWith("proof");
    expect(mocks.commitPasswordChangeProof).not.toHaveBeenCalled();
  });

  it("clears every outstanding proof after password persistence", async () => {
    await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(mocks.resetPasswordChangeProofs).toHaveBeenCalledOnce();
  });

  it("does not report a failed password change when cookie issuance fails", async () => {
    mocks.setDashboardAuthCookie.mockRejectedValueOnce(new Error("cookie unavailable"));

    const response = await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, reauthenticate: true });
    expect(mocks.releasePasswordChangeProof).not.toHaveBeenCalled();
  });

  it("changes password, clears default state, and creates dashboard session", async () => {
    const response = await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      password: "new-hash",
      passwordSessionEpoch: expect.any(String),
    }));
    expect(mocks.invalidateDefaultPasswordCache).toHaveBeenCalledOnce();
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce();
  });
});
