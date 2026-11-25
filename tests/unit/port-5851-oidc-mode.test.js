import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings }));
import { getOidcRuntimeConfig } from "../../src/lib/auth/oidc.js";

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

  it("rejects SAML while retaining legacy OIDC mode", async () => {
    getSettings.mockResolvedValue({ ...settings, ssoType: "saml" });
    expect(await getOidcRuntimeConfig()).toBeNull();
    getSettings.mockResolvedValue({ ...settings, authMode: "oidc" });
    expect(await getOidcRuntimeConfig()).not.toBeNull();
  });
});
