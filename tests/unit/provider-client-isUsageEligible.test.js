import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/constants/providers", () => ({
  USAGE_SUPPORTED_PROVIDERS: ["claude", "codex", "ollama", "kiro"],
  USAGE_APIKEY_PROVIDERS: ["ollama", "kiro"],
}));

vi.mock("@/lib/localDb", () => ({ getProviderConnections: vi.fn() }));
vi.mock("@/lib/oauth/providers", () => ({ backfillCodexEmails: vi.fn() }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({
  backfillCursorEmails: vi.fn(),
}));
vi.mock("@/lib/providers/sanitizeProviderConnectionForClient.js", () => ({
  sanitizeProviderConnectionForClient: vi.fn((c) => c),
}));

import { isUsageEligible } from "../../src/app/api/providers/client/route.js";

describe("isUsageEligible", () => {
  it("returns true for a supported OAuth provider", () => {
    expect(isUsageEligible({ provider: "claude", authType: "oauth" })).toBe(true);
  });

  it("returns true for a supported API-key provider", () => {
    expect(isUsageEligible({ provider: "ollama", authType: "apikey" })).toBe(true);
  });

  it("returns true for the underscore api_key spelling on a supported provider", () => {
    expect(isUsageEligible({ provider: "ollama", authType: "api_key" })).toBe(true);
  });

  it("returns true for Kiro's persisted api_key auth type (direct API-key import)", () => {
    // src/app/api/oauth/kiro/api-key/route.js:37 stores authType "api_key";
    // registry kiro.js has usage:true + usageApikey:true.
    expect(isUsageEligible({ provider: "kiro", authType: "api_key" })).toBe(true);
  });

  it("returns false for api_key on a provider without API-key usage support", () => {
    expect(isUsageEligible({ provider: "claude", authType: "api_key" })).toBe(false);
  });

  it("returns false for unsupported auth type on an API-key provider", () => {
    expect(isUsageEligible({ provider: "ollama", authType: "cookie" })).toBe(false);
  });

  it("returns false for an unsupported provider even with OAuth", () => {
    expect(isUsageEligible({ provider: "openai", authType: "oauth" })).toBe(false);
  });

  it("returns false for an unsupported provider with API key", () => {
    expect(isUsageEligible({ provider: "openai", authType: "apikey" })).toBe(false);
  });

  it("returns false for ollama-local even with API key", () => {
    expect(isUsageEligible({ provider: "ollama-local", authType: "apikey" })).toBe(false);
  });

  it("returns false for a disabled api-key ollama row (stale cloud connection)", () => {
    expect(isUsageEligible({ provider: "ollama", authType: "apikey", isActive: false })).toBe(false);
  });

  it("returns true for an active api-key ollama row", () => {
    expect(isUsageEligible({ provider: "ollama", authType: "apikey", isActive: true })).toBe(true);
  });

  it("keeps a disabled OAuth claude row eligible so it can be reconnected", () => {
    expect(isUsageEligible({ provider: "claude", authType: "oauth", isActive: false })).toBe(true);
  });
});

export {};
