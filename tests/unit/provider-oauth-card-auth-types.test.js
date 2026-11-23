import { describe, expect, it } from "vitest";
import {
  OAUTH_STATUS_AUTH_TYPES,
  getProviderStatus,
} from "../../src/app/(dashboard)/dashboard/providers/providerFilters.js";

describe("OAuth provider card auth scope", () => {
  it("includes OAuth, API-key and auth-token connection spellings", () => {
    expect(OAUTH_STATUS_AUTH_TYPES).toEqual(["oauth", "access_token", "apikey", "api_key", "auth_token"]);
  });

  it("shows an auth_token codebuddy-cn connection on the OAuth card", () => {
    const connections = [{ provider: "codebuddy-cn", authType: "auth_token", isActive: true }];
    expect(getProviderStatus(connections, "codebuddy-cn", OAUTH_STATUS_AUTH_TYPES)).toBe("active");
    expect(
      getProviderStatus(
        [{ provider: "codebuddy-cn", authType: "auth_token", isActive: false }],
        "codebuddy-cn",
        OAUTH_STATUS_AUTH_TYPES,
      ),
    ).toBe("deactivated");
  });
});
