import { describe, it, expect } from "vitest";
import { isProviderConfigured } from "../../src/app/(dashboard)/dashboard/providers/providerFilters.js";

describe("isProviderConfigured", () => {
  it("returns true when any matching provider connection exists", () => {
    expect(
      isProviderConfigured([{ provider: "openai", authType: "oauth" }], "openai"),
    ).toBe(true);
  });

  it("returns true for apikey connections", () => {
    expect(
      isProviderConfigured([{ provider: "openai", authType: "apikey" }], "openai"),
    ).toBe(true);
  });

  it("returns true for web-cookie (cookie) connections", () => {
    expect(
      isProviderConfigured([{ provider: "poe", authType: "cookie" }], "poe"),
    ).toBe(true);
  });

  it("returns true for imported OAuth (access_token) connections", () => {
    expect(
      isProviderConfigured([{ provider: "github", authType: "access_token" }], "github"),
    ).toBe(true);
  });

  it("returns true for noAuth providers regardless of connections", () => {
    expect(isProviderConfigured([], "openrouter", true)).toBe(true);
  });

  it("returns false when no matching connection exists", () => {
    expect(
      isProviderConfigured([{ provider: "openai", authType: "apikey" }], "anthropic"),
    ).toBe(false);
  });
});
