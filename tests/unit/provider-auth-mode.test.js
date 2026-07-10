import { describe, it, expect } from "vitest";
import {
  isNoAuthOnlyProvider,
  shouldShowProviderConnections,
} from "@/shared/utils/providerAuthMode";

describe("isNoAuthOnlyProvider", () => {
  it("returns true for providers with noAuth and no apikey auth mode", () => {
    expect(isNoAuthOnlyProvider({ noAuth: true, authModes: [] })).toBe(true);
    expect(isNoAuthOnlyProvider({ noAuth: true })).toBe(true);
  });

  it("returns false for dual-auth no-auth providers that support apikey", () => {
    // Pollinations advertises both noAuth (free catalog) and apikey (premium key).
    expect(
      isNoAuthOnlyProvider({ noAuth: true, authModes: ["apikey"] })
    ).toBe(false);
  });

  it("returns false for non-no-auth providers", () => {
    expect(isNoAuthOnlyProvider({ noAuth: false, authModes: ["apikey"] })).toBe(
      false
    );
    expect(isNoAuthOnlyProvider({ authModes: ["apikey"] })).toBe(false);
  });
});

describe("shouldShowProviderConnections", () => {
  it("keeps optional API-key connections reachable for dual-auth providers", () => {
    expect(shouldShowProviderConnections({
      id: "pollinations",
      noAuth: true,
      authModes: ["apikey"],
    })).toBe(true);
  });

  it("hides saved connections for pure no-auth providers", () => {
    expect(shouldShowProviderConnections({ noAuth: true })).toBe(false);
  });

  it("keeps stored no-auth account providers on the connections surface", () => {
    expect(shouldShowProviderConnections({ noAuth: true }, { storedNoAuth: true })).toBe(true);
  });
});
