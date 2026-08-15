import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class PasswordEpochMismatchError extends Error {},
  setDashboardAuthCookie: vi.fn(),
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
  cookies: vi.fn(),
  genSalt: vi.fn(),
  hash: vi.fn(),
  invalidateDefaultPasswordCache: vi.fn(),
  verifyDashboardPassword: vi.fn(() => Promise.resolve(true)),
  DEFAULT_PASSWORD: "123456",
  validateDashboardPassword: vi.fn(() => null),
  resetPasswordChangeProofs: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/shared/constants/freeNoAuthProviders", () => ({ FREE_NO_AUTH_PROVIDER_IDS: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  updateSettingsWithPasswordEpoch: mocks.updateSettingsWithPasswordEpoch,
  PasswordEpochMismatchError: mocks.PasswordEpochMismatchError,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: mocks.DEFAULT_PASSWORD,
  invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache,
  verifyDashboardPassword: mocks.verifyDashboardPassword,
  validateDashboardPassword: mocks.validateDashboardPassword,
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
}));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));
vi.mock("bcryptjs", () => ({ default: { genSalt: mocks.genSalt, hash: mocks.hash } }));

const { PATCH } = await import("../../src/app/api/settings/route.js");

describe("settings password update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.genSalt.mockResolvedValue("salt");
    mocks.hash.mockResolvedValue("new-hash");
    mocks.updateSettingsWithPasswordEpoch.mockImplementation(async (updates) => updates);
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
    mocks.updateSettings.mockImplementation(async (updates) => updates);
  });

  it("invalidates default-password state only after storing a replacement password", async () => {
    const response = await PATCH({
      json: async () => ({ currentPassword: "anything", newPassword: "long-enough-password" }),
    });

    expect(mocks.updateSettingsWithPasswordEpoch).toHaveBeenCalledWith(expect.objectContaining({ password: "new-hash" }), "initial");
    expect(mocks.invalidateDefaultPasswordCache).toHaveBeenCalledOnce();
  });

  it("does not invalidate default-password state when storing the replacement fails", async () => {
    mocks.updateSettingsWithPasswordEpoch.mockRejectedValue(new Error("database unavailable"));

    const response = await PATCH({
      json: async () => ({ currentPassword: "anything", newPassword: "long-enough-password" }),
    });

    expect(response.status).toBe(500);
    expect(mocks.invalidateDefaultPasswordCache).not.toHaveBeenCalled();
  });
});
