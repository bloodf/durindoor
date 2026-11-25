import { describe, expect, it } from "vitest";
import { getProvider } from "../../src/lib/oauth/providers.js";

const claude = getProvider("claude");

const tokenIdentity = {
  account: { email_address: "token@example.test", uuid: "token-account" },
  organization: { uuid: "token-org", name: "Token Org" },
};

function map(profile, tokens = tokenIdentity) {
  return claude.mapTokens({ access_token: "access", ...tokens }, { profile });
}

describe("Claude token identity mapping", () => {
  it("prefers populated profile identity values", () => {
    const result = map({
      account: { email: "profile@example.test", uuid: "profile-account" },
      organization: { uuid: "profile-org", name: "Profile Org" },
    });

    expect(result.email).toBe("profile@example.test");
    expect(result.providerSpecificData).toMatchObject({
      claudeAccountUuid: "profile-account",
      claudeOrgUuid: "profile-org",
      claudeOrgName: "Profile Org",
    });
  });

  it.each([
    ["email", { account: { uuid: "profile-account" }, organization: { uuid: "profile-org", name: "Profile Org" } }, "email", "token@example.test"],
    ["account UUID", { account: { email: "profile@example.test" }, organization: { uuid: "profile-org", name: "Profile Org" } }, "claudeAccountUuid", "token-account"],
    ["organization UUID", { account: { email: "profile@example.test", uuid: "profile-account" }, organization: { name: "Profile Org" } }, "claudeOrgUuid", "token-org"],
    ["organization name", { account: { email: "profile@example.test", uuid: "profile-account" }, organization: { uuid: "profile-org" } }, "claudeOrgName", "Token Org"],
  ])("falls back to token %s independently", (_field, profile, outputField, value) => {
    const result = map(profile);
    if (outputField === "email") expect(result.email).toBe(value);
    else expect(result.providerSpecificData[outputField]).toBe(value);
  });

  it("treats empty profile strings as missing", () => {
    const result = map({
      account: { email: "", uuid: "" },
      organization: { uuid: "", name: "" },
    });

    expect(result.email).toBe("token@example.test");
    expect(result.providerSpecificData).toMatchObject({
      claudeAccountUuid: "token-account",
      claudeOrgUuid: "token-org",
      claudeOrgName: "Token Org",
    });
  });
});
