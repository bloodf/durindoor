import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class PasswordEpochMismatchError extends Error {},
  genSalt: vi.fn(),
  hash: vi.fn(),
  compare: vi.fn(),
  invalidateDefaultPasswordCache: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  resetPasswordChangeProofs: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
  cookies: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  consoleError: vi.fn(),
  consoleLog: vi.fn(),
  randomBytes: vi.fn(() => ({ toString: () => "rotated-epoch" })),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/shared/constants/freeNoAuthProviders", () => ({ FREE_NO_AUTH_PROVIDER_IDS: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  updateSettingsWithPasswordEpoch: mocks.updateSettingsWithPasswordEpoch,
  PasswordEpochMismatchError: mocks.PasswordEpochMismatchError,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.applyOutboundProxyEnv }));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
  resetComboScoring: mocks.resetComboScoring,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: "123456",
  invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache,
  verifyDashboardPassword: mocks.verifyDashboardPassword,
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
  validateDashboardPassword: (password) => {
    if (typeof password !== "string" || password.length < 6) return "Password must be at least 6 characters";
    if (password === "123456") return "Password must not use the built-in default";
    return null;
  },
}));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: mocks.resetPasswordChangeProofs }));
vi.mock("bcryptjs", () => ({
  default: {
    genSalt: mocks.genSalt,
    hash: mocks.hash,
    compare: mocks.compare,
  },
}));
vi.mock("node:crypto", () => ({ default: { randomBytes: mocks.randomBytes } }));

const { PATCH } = await import("../../src/app/api/settings/route.js");

describe("settings PATCH password credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.genSalt.mockResolvedValue("salt");
    mocks.hash.mockResolvedValue("new-hash");
    mocks.updateSettings.mockImplementation(async (updates) => updates);
    mocks.updateSettingsWithPasswordEpoch.mockImplementation(async (updates) => updates);
    mocks.compare.mockResolvedValue(false);
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
    vi.spyOn(console, "error").mockImplementation(mocks.consoleError);
    vi.spyOn(console, "log").mockImplementation(mocks.consoleLog);
  });

  it("rejects newPassword equal to the built-in default", async () => {
    mocks.getSettings.mockResolvedValue({ password: "stored-hash" });

    const response = await PATCH({
      json: async () => ({
        currentPassword: "long-enough-current",
        newPassword: "123456",
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.invalidateDefaultPasswordCache).not.toHaveBeenCalled();
  });

  it("rejects newPassword equal to INITIAL_PASSWORD when no stored hash is configured", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    mocks.getSettings.mockResolvedValue({});

    const response = await PATCH({
      json: async () => ({ newPassword: "operator-secret" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects newPassword equal to INITIAL_PASSWORD when stored hash matches it", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    mocks.compare.mockResolvedValue(true);
    mocks.getSettings.mockResolvedValue({ password: "stored-hash" });

    const response = await PATCH({
      json: async () => ({
        currentPassword: "operator-secret",
        newPassword: "operator-secret",
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("strips currentPassword and newPassword from the persistence body", async () => {
    mocks.getSettings.mockResolvedValue({ password: "stored-hash" });
    mocks.compare.mockResolvedValue(true);
    mocks.updateSettings.mockResolvedValue({ password: "new-hash" });

    const response = await PATCH({
      json: async () => ({
        currentPassword: "long-enough-current",
        newPassword: "long-enough-new",
        tunnelDashboardAccess: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSettingsWithPasswordEpoch).toHaveBeenCalledWith(expect.objectContaining({
      password: "new-hash",
      tunnelDashboardAccess: false,
    }), "initial");
    const persisted = mocks.updateSettingsWithPasswordEpoch.mock.calls[0][0];
    expect(persisted).not.toHaveProperty("currentPassword");
    expect(persisted).not.toHaveProperty("newPassword");
  });

  it("uses INITIAL_PASSWORD for the no-hash current-password check", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    mocks.getSettings.mockResolvedValue({});
    mocks.verifyDashboardPassword.mockResolvedValue(false);

    const response = await PATCH({ json: async () => ({ currentPassword: "wrong", newPassword: "long-enough-new" }) });

    expect(response.status).toBe(401);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("requires currentPassword when no stored hash is configured", async () => {
    mocks.getSettings.mockResolvedValue({});

    const response = await PATCH({ json: async () => ({ newPassword: "long-enough-new" }) });

    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects an explicit empty replacement password", async () => {
    const response = await PATCH({ json: async () => ({ currentPassword: "operator-secret", newPassword: "" }) });

    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("clears outstanding password-change proofs after password persistence", async () => {
    mocks.getSettings.mockResolvedValue({ password: "stored-hash" });

    await PATCH({ json: async () => ({ currentPassword: "operator-secret", newPassword: "long-enough-new" }) });

    expect(mocks.resetPasswordChangeProofs).toHaveBeenCalledOnce();
  });

  it("accepts INITIAL_PASSWORD as the current password when no hash is stored", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    mocks.getSettings.mockResolvedValue({});

    const response = await PATCH({
      json: async () => ({
        currentPassword: "operator-secret",
        newPassword: "long-enough-new",
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSettingsWithPasswordEpoch).toHaveBeenCalledWith(expect.objectContaining({
      password: "new-hash",
    }), "initial");
  });

  it("rotates the current password session cookie after persisting a password", async () => {
    mocks.getSettings.mockResolvedValue({ password: "stored-hash" });

    await PATCH({ json: async () => ({ currentPassword: "operator-secret", newPassword: "long-enough-new" }) });

    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledWith(
      { set: expect.any(Function) }, expect.anything(), { passwordSessionEpoch: "rotated-epoch" }, "rotated-epoch",
    );
  });

  it("does not return success when signing races with a newer password epoch", async () => {
    mocks.getSettings
      .mockResolvedValueOnce({ password: "stored-hash", passwordSessionEpoch: "initial" })
      .mockResolvedValueOnce({ passwordSessionEpoch: "newer-epoch" });
    let resume;
    mocks.setDashboardAuthCookie.mockImplementation(async () => {
      await new Promise((resolve) => { resume = resolve; });
      throw new Error("AUTH_EPOCH_RACE");
    });

    const pending = PATCH({ json: async () => ({ currentPassword: "operator-secret", newPassword: "long-enough-new" }) });
    await vi.waitFor(() => expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce());
    resume();
    const response = await pending;

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Password change conflict, please retry" });
  });

  it("returns a stable error without logging a settings exception", async () => {
    mocks.updateSettings.mockRejectedValue(new Error("SENTINEL_SETTINGS_ERROR"));

    const response = await PATCH({ json: async () => ({ tunnelDashboardAccess: true }) });

    expect(response.body).toEqual({ error: "Failed to update settings" });
    expect(mocks.consoleError).toHaveBeenCalledWith("[settings] update failed");
    expect(mocks.consoleError).not.toHaveBeenCalledWith(expect.stringContaining("SENTINEL_SETTINGS_ERROR"));
  });
});
