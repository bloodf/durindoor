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

  it.each([
    ["openai", true, { openaiStoreEnabled: true }],
    ["openai", false, { openaiStoreEnabled: false }],
    ["openai-compatible-responses-test", true, { openaiStoreEnabled: true }],
    ["openai-compatible-responses-test", false, { openaiStoreEnabled: false }],
    ["codex", true, {}],
    ["codex", false, {}],
    ["openai-compatible-chat-test", true, {}],
    ["openai-compatible-chat-test", false, {}],
  ])("projects OpenAI store setting only for eligible %s connections", (provider, openaiStoreEnabled, providerSpecificData) => {
    const out = sanitizeProviderConnectionForClient({
      id: "c1",
      provider,
      providerSpecificData: { openaiStoreEnabled },
    });

    expect(out.providerSpecificData).toEqual(providerSpecificData);
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

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("does not fabricate active for %s testStatus", (_label, testStatus) => {
    const out = sanitizeProviderConnectionForClient({
      id: "unknown-status",
      provider: "kiro",
      testStatus,
    });

    expect(out.testStatus).toBe(testStatus);
    expect(out.testStatus).not.toBe("active");
  });

  it("passes through unknown future testStatus values", () => {
    const out = sanitizeProviderConnectionForClient({
      id: "future-status",
      provider: "kiro",
      testStatus: "degraded",
    });

    expect(out.testStatus).toBe("degraded");
  });

  it("reports expired cooldowns active while preserving live cooldown status", () => {
    const expired = sanitizeProviderConnectionForClient({
      id: "expired",
      provider: "kiro",
      testStatus: "unavailable",
      "modelLock_claude-opus-5": "2000-01-01T00:00:00Z",
    });
    const live = sanitizeProviderConnectionForClient({
      id: "live",
      provider: "kiro",
      testStatus: "unavailable",
      "modelLock_claude-opus-5": "2999-01-01T00:00:00Z",
    });

    expect(expired.testStatus).toBe("active");
    expect(live.testStatus).toBe("unavailable");
    expect(expired).not.toHaveProperty("modelLock_claude-opus-5");
  });
});
