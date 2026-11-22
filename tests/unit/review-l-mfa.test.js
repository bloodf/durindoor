import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: {}, getSettings: vi.fn(), updateSettings: vi.fn(), consumeBackupCodeAtomic: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ ...mocks.settings }),
  updateSettings: async (patch) => { mocks.settings = { ...mocks.settings, ...patch }; mocks.updateSettings(patch); },
}));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({ consumeBackupCodeAtomic: mocks.consumeBackupCodeAtomic }));

const { verifySecondFactor } = await import("../../src/lib/auth/mfa.js");
const { generateTotpSecret, generateTotpCode, totpCounter } = await import("../../src/lib/auth/totp.js");
const { isUsingDefaultPassword, invalidateDefaultPasswordCache } = await import("../../src/lib/auth/dashboardSession.js");

describe("issue #2197 MFA hardening", () => {
  beforeEach(() => {
    mocks.settings = { mfaEnabled: true, mfaSecret: generateTotpSecret(), mfaBackupCodes: [] };
    mocks.updateSettings.mockClear();
    mocks.consumeBackupCodeAtomic.mockReset();
    delete process.env.INITIAL_PASSWORD;
    invalidateDefaultPasswordCache();
  });

  it("accepts a TOTP counter once and persists it for subsequent verification", async () => {
    const counter = totpCounter();
    const code = generateTotpCode(mocks.settings.mfaSecret, counter);
    expect((await verifySecondFactor(code)).ok).toBe(true);
    expect(mocks.settings.mfaLastTotpCounter).toBe(counter);
    expect((await verifySecondFactor(code)).ok).toBe(false);
  });

  it("treats the built-in default as active when no password source is configured", async () => {
    await expect(isUsingDefaultPassword({})).resolves.toBe(true);
  });
});
