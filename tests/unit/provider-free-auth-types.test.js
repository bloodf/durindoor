import { describe, it, expect } from "vitest";
import { getFreeAuthTypes, OAUTH_AUTH_TYPES } from "../../src/app/(dashboard)/dashboard/providers/providerFilters.js";

// port(upstream): 0e5da70c — freeTier/apikey providers missing authModes must
// still expose apikey auth on their provider card instead of collapsing to
// oauth-only.
describe("getFreeAuthTypes", () => {
  it("always returns full dual-auth scope for kiro", () => {
    expect(getFreeAuthTypes("kiro", {})).toEqual(["oauth", "apikey", "api_key"]);
  });

  it("returns declared authModes when present", () => {
    expect(getFreeAuthTypes("x", { authModes: ["apikey"] })).toEqual(["apikey"]);
  });

  it("wraps a single authType when authModes is absent", () => {
    expect(getFreeAuthTypes("x", { authType: "apikey" })).toEqual(["apikey"]);
  });

  it("falls back to full dual-auth scope for a known freeTier provider missing authModes/authType", () => {
    expect(getFreeAuthTypes("cloudflare-ai", {})).toEqual(["oauth", "apikey", "api_key"]);
  });

  it("falls back to full dual-auth scope for a known apikey provider missing authModes/authType", () => {
    expect(getFreeAuthTypes("openai", {})).toEqual(["oauth", "apikey", "api_key"]);
  });

  it("falls back to oauth-only for an unknown provider missing authModes/authType", () => {
    expect(getFreeAuthTypes("totally-unknown-provider", {})).toEqual(OAUTH_AUTH_TYPES);
  });
});
