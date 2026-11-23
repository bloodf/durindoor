import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: {}, getSettings: vi.fn(), updateSettings: vi.fn(), cookieDelete: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: mocks.cookieDelete }) }));

const session = await import("../../src/lib/auth/dashboardSession.js");
const { disableMfa } = await import("../../src/lib/auth/mfa.js");
const logout = await import("../../src/app/api/auth/logout/route.js");

describe("dashboard session revocation across MFA and logout (#2244)", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "unit-test-jwt-secret-do-not-reuse");
    session.__resetJwtSecretForTests();
    mocks.settings = { passwordSessionEpoch: "epoch-A", mfaEnabled: false, mfaSecret: "" };
    mocks.getSettings.mockImplementation(async () => ({ ...mocks.settings }));
    mocks.updateSettings.mockImplementation(async (patch) => {
      mocks.settings = { ...mocks.settings, ...patch };
    });
    mocks.cookieDelete.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    session.__resetJwtSecretForTests();
  });

  it("rejects sessions without an MFA claim while MFA is enabled", async () => {
    const oldSession = await session.createDashboardAuthToken({ passwordSessionEpoch: "epoch-A" });
    const mfaSession = await session.createDashboardAuthToken({ passwordSessionEpoch: "epoch-A", mfa: "totp" });
    mocks.settings = { ...mocks.settings, mfaEnabled: true, mfaSecret: "seed" };

    await expect(session.verifyDashboardAuthToken(oldSession)).resolves.toBe(false);
    await expect(session.getDashboardAuthSession(oldSession)).resolves.toBeNull();
    await expect(session.verifyDashboardAuthToken(mfaSession)).resolves.toBe(true);
  });

  it("rotates the epoch when a dashboard session is logged out", async () => {
    const token = await session.createDashboardAuthToken({ passwordSessionEpoch: "epoch-A", mfa: "totp" });
    await logout.POST();

    expect(mocks.settings.passwordSessionEpoch).not.toBe("epoch-A");
    expect(mocks.cookieDelete).toHaveBeenCalledWith("auth_token");
    await expect(session.verifyDashboardAuthToken(token)).resolves.toBe(false);
  });

  it("atomically rotates the epoch while disabling MFA", async () => {
    mocks.settings = { ...mocks.settings, mfaEnabled: true, mfaSecret: "seed" };

    await disableMfa();

    expect(mocks.settings).toMatchObject({ mfaEnabled: false, mfaSecret: "", mfaBackupCodes: [], mfaLastTotpCounter: null });
    expect(mocks.settings.passwordSessionEpoch).not.toBe("epoch-A");
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ mfaEnabled: false, passwordSessionEpoch: expect.any(String) }));
  });
});
