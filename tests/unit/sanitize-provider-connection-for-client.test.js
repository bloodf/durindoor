import { describe, it, expect } from "vitest";
import { sanitizeProviderConnectionForClient } from "../../src/lib/providers/sanitizeProviderConnectionForClient.js";

describe("sanitizeProviderConnectionForClient", () => {
  it("keeps allowlisted fields", () => {
    const c = {
      id: "c1",
      provider: "openai",
      name: "Home OpenAI",
      isActive: true,
      priority: 1,
    };
    const out = sanitizeProviderConnectionForClient(c);
    expect(out).toEqual(c);
  });

  it("drops credential fields", () => {
    const c = {
      id: "c1",
      provider: "openai",
      apiKey: "sk-secret",
      accessToken: "at-secret",
      refreshToken: "rt-secret",
      idToken: "id-secret",
    };
    const out = sanitizeProviderConnectionForClient(c);
    expect(out.apiKey).toBeUndefined();
    expect(out.accessToken).toBeUndefined();
    expect(out.refreshToken).toBeUndefined();
    expect(out.idToken).toBeUndefined();
  });

  it("drops OAuth cookie-like fields and clientSecret in providerSpecificData", () => {
    const c = {
      id: "c1",
      provider: "cursor",
      providerSpecificData: {
        cookie: "session=leak",
        accessToken: "oauth-at",
        refreshToken: "oauth-rt",
        clientSecret: "cs-secret",
        baseUrl: "https://api.cursor.sh",
      },
    };
    const out = sanitizeProviderConnectionForClient(c);
    expect(out.providerSpecificData).toEqual({ baseUrl: "https://api.cursor.sh" });
    expect(out.providerSpecificData.cookie).toBeUndefined();
    expect(out.providerSpecificData.clientSecret).toBeUndefined();
  });

  it("drops unknown future secrets", () => {
    const c = {
      id: "c1",
      provider: "openai",
      signingKey: "should-be-secret",
      certificate: "should-be-secret",
    };
    const out = sanitizeProviderConnectionForClient(c);
    expect(out.signingKey).toBeUndefined();
    expect(out.certificate).toBeUndefined();
  });

  it("masks long hex-looking names", () => {
    const c = { id: "c1", provider: "openai", name: "a".repeat(64) };
    const out = sanitizeProviderConnectionForClient(c);
    expect(out.name).toMatch(/^aaaaaaaa\*\*\*$/);
  });
});
