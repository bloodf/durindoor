import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings }));
import { getOidcRuntimeConfig, isPasswordLoginAllowed, resolveSsoType } from "../../src/lib/auth/oidc.js";
import { validateSettingsPatch } from "../../src/lib/settings/settingsSchema.js";

const settings = {
  authMode: "sso",
  ssoType: "oidc",
  oidcIssuerUrl: "https://idp.example.com/",
  oidcClientId: "client",
  oidcClientSecret: "secret",
  oidcAllowedEmails: "user@example.com",
};

describe("9router #5851 668a4af84aaab0bc50975b0e995f834c62d4d33b OIDC mode", () => {
  beforeEach(() => getSettings.mockReset());

  it.each(["oidc", undefined])("accepts generic SSO with protocol %s", async (ssoType) => {
    getSettings.mockResolvedValue({ ...settings, ssoType });
    expect((await getOidcRuntimeConfig())?.issuerUrl).toBe("https://idp.example.com");
  });

  it("rejects unsupported ssoType values in settings patches", () => {
    expect(validateSettingsPatch({ ssoType: "saml" })).toEqual(["ssoType"]);
    expect(validateSettingsPatch({ ssoType: "" })).toEqual(["ssoType"]);
    expect(validateSettingsPatch({ ssoType: "oidc" })).toEqual([]);
  });

  it.each(["saml", "", 42])("keeps a working login method when stored ssoType is %s", async (ssoType) => {
    expect(resolveSsoType(ssoType)).toBe("oidc");
    const stored = { ...settings, ssoType };
    getSettings.mockResolvedValue(stored);
    const config = await getOidcRuntimeConfig();
    // Password login is off in configured SSO mode, so OIDC must stay available.
    expect(isPasswordLoginAllowed(stored)).toBe(false);
    expect(config?.issuerUrl).toBe("https://idp.example.com");
  });

  it("retains legacy OIDC mode", async () => {
    getSettings.mockResolvedValue({ ...settings, authMode: "oidc" });
    expect(await getOidcRuntimeConfig()).not.toBeNull();
  });
});
