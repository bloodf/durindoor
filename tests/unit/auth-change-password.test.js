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
  updateSettingsWithPasswordEpoch: vi.fn(),
  getSettings: vi.fn(),
  PasswordEpochMismatchError: class PasswordEpochMismatchError extends Error {},
  DEFAULT_PASSWORD: "123456",
  invalidateDefaultPasswordCache: vi.fn(),
  cookies: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  validateDashboardPassword: vi.fn((password) => {
    if (typeof password !== "string" || password.length < 6) return "Password must be at least 6 characters";
    return password === "123456" ? "Password must not use the built-in default" : null;
  }),
  consoleError: vi.fn(),
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
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, updateSettingsWithPasswordEpoch: mocks.updateSettingsWithPasswordEpoch, PasswordEpochMismatchError: mocks.PasswordEpochMismatchError }));
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
    mocks.reservePasswordChangeProof.mockReturnValue({ clientIp: "198.51.100.4", passwordSessionEpoch: "initial" });
    mocks.updateSettingsWithPasswordEpoch.mockResolvedValue({ password: "new-hash" });
    mocks.getSettings.mockResolvedValue({ passwordSessionEpoch: "new-epoch" });
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
    vi.spyOn(console, "error").mockImplementation(mocks.consoleError);
  });

  it("rejects a missing or invalid flow proof before changing password", async () => {
    const missing = await POST(request({ newPassword: "long-enough-password" }));
    expect(missing.status).toBe(403);
    expect(mocks.updateSettingsWithPasswordEpoch).not.toHaveBeenCalled();

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

  it("redacts unexpected persistence failures", async () => {
    mocks.updateSettingsWithPasswordEpoch.mockRejectedValueOnce(new Error("SENTINEL_CHANGE_ERROR"));

    const response = await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Password change failed" });
    expect(mocks.consoleError).toHaveBeenCalledWith("[auth] password change failed");
    expect(mocks.consoleError).not.toHaveBeenCalledWith(expect.stringContaining("SENTINEL_CHANGE_ERROR"));
    expect(mocks.reservePasswordChangeProof).toHaveBeenCalledWith("proof", "198.51.100.4");
    expect(mocks.releasePasswordChangeProof).toHaveBeenCalledWith("proof");
    expect(mocks.commitPasswordChangeProof).not.toHaveBeenCalled();
  });

  it("clears every outstanding proof after password persistence", async () => {
    await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(mocks.resetPasswordChangeProofs).toHaveBeenCalledOnce();
  });

  it("redacts cookie issuance failure when durable change succeeded", async () => {
    mocks.setDashboardAuthCookie.mockRejectedValueOnce(new Error("SENTINEL_COOKIE_ERROR"));

    const response = await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, reauthenticate: true });
    expect(mocks.consoleError).toHaveBeenCalledWith("[auth] password change cookie failed");
    expect(mocks.consoleError).not.toHaveBeenCalledWith(expect.stringContaining("SENTINEL_COOKIE_ERROR"));
    expect(mocks.releasePasswordChangeProof).not.toHaveBeenCalled();
  });

  it("changes password, clears default state, and creates dashboard session", async () => {
    const response = await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mocks.updateSettingsWithPasswordEpoch).toHaveBeenCalledWith(expect.objectContaining({
      password: "new-hash",
      passwordSessionEpoch: expect.any(String),
    }), "initial");
    expect(mocks.invalidateDefaultPasswordCache).toHaveBeenCalledOnce();
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce();
  });

  it("returns 409 without cookie, cache reset, or proof commit when the bound epoch mismatches", async () => {
    mocks.reservePasswordChangeProof.mockReturnValue({ clientIp: "198.51.100.4", passwordSessionEpoch: "epoch-A" });
    mocks.updateSettingsWithPasswordEpoch.mockRejectedValueOnce(new mocks.PasswordEpochMismatchError());

    const response = await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Password change conflict, please retry" });
    expect(mocks.updateSettingsWithPasswordEpoch).toHaveBeenCalledWith(expect.objectContaining({ password: "new-hash" }), "epoch-A");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    expect(mocks.invalidateDefaultPasswordCache).not.toHaveBeenCalled();
    expect(mocks.commitPasswordChangeProof).not.toHaveBeenCalled();
    expect(mocks.resetPasswordChangeProofs).toHaveBeenCalledOnce();
  });

  it("does not return success when signing races with a newer password epoch", async () => {
    mocks.getSettings.mockResolvedValue({ passwordSessionEpoch: "newer-epoch" });
    let resume;
    mocks.setDashboardAuthCookie.mockImplementation(async () => {
      await new Promise((resolve) => { resume = resolve; });
      throw new Error("AUTH_EPOCH_RACE");
    });

    const pending = POST(request({ proof: "proof", newPassword: "long-enough-password" }));
    await vi.waitFor(() => expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce());
    resume();
    const response = await pending;

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Password change conflict, please retry" });
  });
});
