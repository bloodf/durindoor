import { describe, it, expect } from "vitest";
import { SECRET_SETTING_KEYS, stripSettingKeys } from "../../src/lib/settings/settingsPatchAuth.js";

describe("MFA settings are never mass-assignable (decolua/9router#4144)", () => {
  it("lists mfaEnabled/mfaSecret/mfaBackupCodes as protected", () => {
    expect(SECRET_SETTING_KEYS).toEqual(
      expect.arrayContaining(["mfaEnabled", "mfaSecret", "mfaBackupCodes"]),
    );
  });

  it("strips mfa fields from an arbitrary PATCH body", () => {
    const body = { mfaEnabled: true, mfaSecret: "attacker-secret", mfaBackupCodes: ["x"], other: 1 };
    const stripped = stripSettingKeys(body, SECRET_SETTING_KEYS);
    expect(stripped).toBe(true);
    expect(body).toEqual({ other: 1 });
  });
});
