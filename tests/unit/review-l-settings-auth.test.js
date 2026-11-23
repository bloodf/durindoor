import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  getSettings: vi.fn(), updateSettings: vi.fn(), updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class PasswordEpochMismatchError extends Error {},
  genSalt: vi.fn(), hash: vi.fn(), verifyDashboardPassword: vi.fn(),
  invalidateDefaultPasswordCache: vi.fn(), resetPasswordChangeProofs: vi.fn(),
  applyOutboundProxyEnv: vi.fn(), resetComboRotation: vi.fn(), resetComboScoring: vi.fn(),
  cookies: vi.fn(), setDashboardAuthCookie: vi.fn(), randomBytes: vi.fn(() => ({ toString: () => "rotated-epoch" })),
  verifySecondFactor: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/shared/constants/freeNoAuthProviders", () => ({ FREE_NO_AUTH_PROVIDER_IDS: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings, updateSettings: mocks.updateSettings,
  updateSettingsWithPasswordEpoch: mocks.updateSettingsWithPasswordEpoch,
  PasswordEpochMismatchError: mocks.PasswordEpochMismatchError,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.applyOutboundProxyEnv }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: mocks.resetComboRotation, resetComboScoring: mocks.resetComboScoring }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: "123456", invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache,
  verifyDashboardPassword: mocks.verifyDashboardPassword, setDashboardAuthCookie: mocks.setDashboardAuthCookie,
  validateDashboardPassword: () => null,
}));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: mocks.resetPasswordChangeProofs }));
vi.mock("@/lib/auth/mfa", () => ({ isMfaEnabled: (settings) => settings?.mfaEnabled === true && !!settings?.mfaSecret, verifySecondFactor: mocks.verifySecondFactor }));
vi.mock("bcryptjs", () => ({ default: { genSalt: mocks.genSalt, hash: mocks.hash } }));
vi.mock("node:crypto", () => ({ default: { randomBytes: mocks.randomBytes } }));

const { PATCH } = await import("../../src/app/api/settings/route.js");
const { AUTH_CRITICAL_SETTING_KEYS, stripSettingKeys } = await import("../../src/lib/settings/settingsPatchAuth.js");

describe("review l settings auth regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ passwordSessionEpoch: "epoch-A" });
    mocks.genSalt.mockResolvedValue("salt");
    mocks.hash.mockResolvedValue("new-hash");
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    mocks.verifySecondFactor.mockResolvedValue({ ok: false, method: null });
    mocks.updateSettingsWithPasswordEpoch.mockImplementation(async (updates) => updates);
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
  });

  it("strips every headroom and MITM router target from unproved settings patches", () => {
    const keys = ["headroomEnabled", "headroomUrl", "headroomCompressUserMessages", "mitmRouterBaseUrl"];
    expect(AUTH_CRITICAL_SETTING_KEYS).toEqual(expect.arrayContaining(keys));
    const patch = Object.fromEntries(keys.map((key) => [key, "attacker-controlled"]));
    expect(stripSettingKeys(patch, AUTH_CRITICAL_SETTING_KEYS)).toBe(true);
    expect(patch).toEqual({});
  });

  it("requires an MFA code before changing a password when MFA is enabled", async () => {
    mocks.getSettings.mockResolvedValue({ mfaEnabled: true, mfaSecret: "secret", passwordSessionEpoch: "epoch-A" });

    const response = await PATCH({ json: async () => ({ currentPassword: "current", newPassword: "long-enough-password" }) });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid MFA code" });
    expect(mocks.verifySecondFactor).toHaveBeenCalledWith(undefined);
    expect(mocks.updateSettingsWithPasswordEpoch).not.toHaveBeenCalled();
  });

  it("accepts a valid MFA code for password change and does not persist the code", async () => {
    mocks.getSettings.mockResolvedValue({ mfaEnabled: true, mfaSecret: "secret", passwordSessionEpoch: "epoch-A" });
    mocks.verifySecondFactor.mockResolvedValue({ ok: true, method: "totp" });

    const response = await PATCH({ json: async () => ({ currentPassword: "current", newPassword: "long-enough-password", mfaCode: "123456" }) });

    expect(response.status).toBe(200);
    expect(mocks.verifySecondFactor).toHaveBeenCalledWith("123456");
    expect(mocks.updateSettingsWithPasswordEpoch).toHaveBeenCalledWith(expect.not.objectContaining({ mfaCode: "123456" }), "epoch-A");
  });
});
