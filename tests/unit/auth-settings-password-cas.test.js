import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  getSettings: vi.fn(), updateSettings: vi.fn(), updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class PasswordEpochMismatchError extends Error {},
  genSalt: vi.fn(), hash: vi.fn(), invalidateDefaultPasswordCache: vi.fn(), verifyDashboardPassword: vi.fn(),
  resetPasswordChangeProofs: vi.fn(), applyOutboundProxyEnv: vi.fn(), resetComboRotation: vi.fn(), resetComboScoring: vi.fn(),
  cookies: vi.fn(), setDashboardAuthCookie: vi.fn(), randomBytes: vi.fn(() => ({ toString: () => "rotated-epoch" })),
}));
vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/shared/constants/freeNoAuthProviders", () => ({ FREE_NO_AUTH_PROVIDER_IDS: [] }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, updateSettings: mocks.updateSettings, updateSettingsWithPasswordEpoch: mocks.updateSettingsWithPasswordEpoch, PasswordEpochMismatchError: mocks.PasswordEpochMismatchError }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.applyOutboundProxyEnv }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: mocks.resetComboRotation, resetComboScoring: mocks.resetComboScoring }));
vi.mock("@/lib/auth/dashboardSession", () => ({ DEFAULT_PASSWORD: "123456", invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache, verifyDashboardPassword: mocks.verifyDashboardPassword, setDashboardAuthCookie: mocks.setDashboardAuthCookie, validateDashboardPassword: () => null }));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: mocks.resetPasswordChangeProofs }));
vi.mock("bcryptjs", () => ({ default: { genSalt: mocks.genSalt, hash: mocks.hash } }));
vi.mock("node:crypto", () => ({ default: { randomBytes: mocks.randomBytes } }));

const { PATCH } = await import("../../src/app/api/settings/route.js");

describe("settings PATCH password epoch CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ passwordSessionEpoch: "epoch-A" });
    mocks.genSalt.mockResolvedValue("salt"); mocks.hash.mockResolvedValue("new-hash");
    mocks.verifyDashboardPassword.mockResolvedValue(true); mocks.cookies.mockResolvedValue({ set: vi.fn() });
  });

  it("returns 409 without side effects when a reset wins during password hashing", async () => {
    mocks.updateSettingsWithPasswordEpoch.mockRejectedValueOnce(new mocks.PasswordEpochMismatchError());
    const response = await PATCH({ json: async () => ({ currentPassword: "anything", newPassword: "long-enough-new" }) });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Password change conflict, please retry" });
    expect(mocks.updateSettingsWithPasswordEpoch).toHaveBeenCalledWith(expect.objectContaining({ password: "new-hash" }), "epoch-A");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    expect(mocks.invalidateDefaultPasswordCache).not.toHaveBeenCalled();
    expect(mocks.resetPasswordChangeProofs).not.toHaveBeenCalled();
  });
});
