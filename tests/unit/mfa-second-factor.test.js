import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  consumeBackupCodeAtomic: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  consumeBackupCodeAtomic: mocks.consumeBackupCodeAtomic,
}));

const { isMfaEnabled, isMfaEnabledNow, verifySecondFactor, disableMfa } = await import(
  "../../src/lib/auth/mfa.js"
);
const { generateTotpSecret, generateTotpCode, totpCounter } = await import("../../src/lib/auth/totp.js");
const { generateBackupCodes, findBackupCodeHashIndexSync } = await import("../../src/lib/auth/backupCodes.js");

describe("isMfaEnabled", () => {
  it("requires both the flag and a stored secret", () => {
    expect(isMfaEnabled({ mfaEnabled: true, mfaSecret: "abc" })).toBe(true);
    expect(isMfaEnabled({ mfaEnabled: true, mfaSecret: "" })).toBe(false);
    expect(isMfaEnabled({ mfaEnabled: false, mfaSecret: "abc" })).toBe(false);
    expect(isMfaEnabled(undefined)).toBe(false);
  });
});

describe("verifySecondFactor", () => {
  const secret = generateTotpSecret();

  beforeEach(() => {
    mocks.getSettings.mockReset();
    mocks.updateSettings.mockReset();
    mocks.consumeBackupCodeAtomic.mockReset();
  });

  it("returns not-ok when MFA is disabled", async () => {
    mocks.getSettings.mockResolvedValue({ mfaEnabled: false, mfaSecret: "" });
    const result = await verifySecondFactor("123456");
    expect(result.ok).toBe(false);
  });

  it("accepts a valid TOTP code without consuming any backup code", async () => {
    mocks.getSettings.mockResolvedValue({ mfaEnabled: true, mfaSecret: secret, mfaBackupCodes: ["h1", "h2"] });
    const code = generateTotpCode(secret, totpCounter());
    const result = await verifySecondFactor(code);
    expect(result).toEqual({ ok: true, method: "totp", backupCodesRemaining: 2 });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects an invalid 6-digit TOTP code", async () => {
    mocks.getSettings.mockResolvedValue({ mfaEnabled: true, mfaSecret: secret, mfaBackupCodes: [] });
    const result = await verifySecondFactor("000000");
    expect(result.ok).toBe(false);
  });

  it("accepts a valid backup code via the atomic consume path, not a getSettings/updateSettings round trip", async () => {
    const { codes, hashes } = await generateBackupCodes(3);
    mocks.getSettings.mockResolvedValue({ mfaEnabled: true, mfaSecret: secret, mfaBackupCodes: hashes });
    mocks.consumeBackupCodeAtomic.mockResolvedValue({ matched: true, backupCodesRemaining: 2 });

    const result = await verifySecondFactor(codes[0]);

    expect(result).toEqual({ ok: true, method: "backup", backupCodesRemaining: 2 });
    expect(mocks.consumeBackupCodeAtomic).toHaveBeenCalledWith(codes[0], findBackupCodeHashIndexSync);
    // The TOCTOU fix means the match+write happens inside consumeBackupCodeAtomic's
    // own transaction, not via a separate getSettings-computed updateSettings call.
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects a backup code the atomic consume path did not match", async () => {
    mocks.getSettings.mockResolvedValue({ mfaEnabled: true, mfaSecret: secret, mfaBackupCodes: ["h1"] });
    mocks.consumeBackupCodeAtomic.mockResolvedValue({ matched: false, backupCodesRemaining: 1 });

    const result = await verifySecondFactor("ZZZZZ-ZZZZZ");
    expect(result.ok).toBe(false);
  });

  it("rejects empty input", async () => {
    mocks.getSettings.mockResolvedValue({ mfaEnabled: true, mfaSecret: secret, mfaBackupCodes: [] });
    const result = await verifySecondFactor("   ");
    expect(result.ok).toBe(false);
  });
});

describe("isMfaEnabledNow / disableMfa", () => {
  beforeEach(() => {
    mocks.getSettings.mockReset();
    mocks.updateSettings.mockReset();
  });

  it("reads through to getSettings", async () => {
    mocks.getSettings.mockResolvedValue({ mfaEnabled: true, mfaSecret: "s" });
    await expect(isMfaEnabledNow()).resolves.toBe(true);
  });

  it("wipes every mfa field", async () => {
    await disableMfa();
    expect(mocks.updateSettings).toHaveBeenCalledWith({ mfaEnabled: false, mfaSecret: "", mfaBackupCodes: [] });
  });
});
