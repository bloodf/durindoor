import { beforeEach, describe, expect, it, vi } from "vitest";
import { isFunction } from "@/shared/utils/typeChecks.js";

const mocks = vi.hoisted(() => ({ settings: {}, getSettings: vi.fn(), updateSettings: vi.fn(), consumeBackupCodeAtomic: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ ...mocks.settings }),
  updateSettings: async (patch) => {
    const updates = isFunction(patch) ? patch(mocks.settings) : patch;
    mocks.settings = { ...mocks.settings, ...updates };
    mocks.updateSettings(patch);
    return { ...mocks.settings };
  },
}));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({ consumeBackupCodeAtomic: mocks.consumeBackupCodeAtomic }));

const { verifySecondFactor } = await import("../../src/lib/auth/mfa.js");
const { generateTotpSecret, generateTotpCode, totpCounter } = await import("../../src/lib/auth/totp.js");
const { isUsingDefaultPassword, invalidateDefaultPasswordCache } = await import("../../src/lib/auth/dashboardSession.js");
const setupRoute = await import("../../src/app/api/auth/mfa/setup/route.js");
const enableRoute = await import("../../src/app/api/auth/mfa/enable/route.js");
const { resetLoginLimiter } = await import("../../src/lib/auth/loginLimiter.js");

function post(handler, payload) {
  return handler(new Request("http://localhost/api/auth/mfa/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

describe("issue #2197 MFA hardening", () => {
  beforeEach(() => {
    mocks.settings = { mfaEnabled: true, mfaSecret: generateTotpSecret(), mfaBackupCodes: [] };
    mocks.updateSettings.mockClear();
    mocks.consumeBackupCodeAtomic.mockReset();
    resetLoginLimiter();
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

  it("refuses the built-in default password for setup and enable re-auth", async () => {
    mocks.settings = { mfaEnabled: false, mfaSecret: "", mfaBackupCodes: [] };
    expect((await post(setupRoute.POST, { password: "123456" })).status).toBe(401);
    expect((await post(enableRoute.POST, { password: "123456", secret: "secret", code: "123456" })).status).toBe(401);
  });

  it("shares the login limiter across setup and enable password re-auth", async () => {
    mocks.settings = { mfaEnabled: false, mfaSecret: "", mfaBackupCodes: [] };
    for (let i = 0; i < 5; i += 1) {
      expect((await post(setupRoute.POST, { password: "incorrect" })).status).toBe(401);
    }
    expect((await post(enableRoute.POST, { password: "incorrect", secret: "secret", code: "123456" })).status).toBe(429);
  });
});
