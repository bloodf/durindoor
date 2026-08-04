import { describe, expect, it } from "vitest";
import { OAUTH_STATUS_AUTH_TYPES } from "../../src/app/(dashboard)/dashboard/providers/providerFilters.js";

describe("OAuth provider card auth scope", () => {
  it("includes both OAuth and API-key connection spellings", () => {
    expect(OAUTH_STATUS_AUTH_TYPES).toEqual(["oauth", "access_token", "apikey", "api_key"]);
  });
});