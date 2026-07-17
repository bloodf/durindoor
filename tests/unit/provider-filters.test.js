import { describe, it, expect } from "vitest";
import {
  isProviderConfigured,
  getProviderStatus,
  OAUTH_AUTH_TYPES,
} from "../../src/app/(dashboard)/dashboard/providers/providerFilters.js";

describe("providerFilters", () => {
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
        isProviderConfigured(
          [{ provider: "github", authType: "access_token" }],
          "github",
        ),
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

  describe("getProviderStatus", () => {
    it("returns active when an oauth connection is present", () => {
      expect(
        getProviderStatus(
          [{ provider: "openai", authType: "oauth" }],
          "openai",
          OAUTH_AUTH_TYPES,
        ),
      ).toBe("active");
    });

    it("returns active for imported access_token connections", () => {
      expect(
        getProviderStatus(
          [{ provider: "codex", authType: "access_token" }],
          "codex",
          OAUTH_AUTH_TYPES,
        ),
      ).toBe("active");
    });

    it("returns deactivated when all matching connections are inactive", () => {
      expect(
        getProviderStatus(
          [
            { provider: "openai", authType: "oauth", isActive: false },
            { provider: "openai", authType: "oauth", isActive: false },
          ],
          "openai",
          OAUTH_AUTH_TYPES,
        ),
      ).toBe("deactivated");
    });

    it("returns active if at least one matching connection is active", () => {
      expect(
        getProviderStatus(
          [
            { provider: "openai", authType: "oauth", isActive: false },
            { provider: "openai", authType: "oauth", isActive: true },
          ],
          "openai",
          OAUTH_AUTH_TYPES,
        ),
      ).toBe("active");
    });

    it("returns not-configured when no matching connection exists", () => {
      expect(
        getProviderStatus(
          [{ provider: "anthropic", authType: "apikey" }],
          "openai",
          OAUTH_AUTH_TYPES,
        ),
      ).toBe("not-configured");
    });

    it("connection status dominates no-auth fallback", () => {
      expect(
        getProviderStatus(
          [{ provider: "opencode", authType: "oauth", isActive: true }],
          "opencode",
          OAUTH_AUTH_TYPES,
          true,
          ["opencode"],
        ),
      ).toBe("active");
    });

    it("returns active for no-auth free providers not in disabled list", () => {
      expect(
        getProviderStatus([], "opencode", OAUTH_AUTH_TYPES, true, []),
      ).toBe("active");
    });

    it("returns deactivated for no-auth free providers in disabled list", () => {
      expect(
        getProviderStatus([], "opencode", OAUTH_AUTH_TYPES, true, ["opencode"]),
      ).toBe("deactivated");
    });

    it("uses authType scope for web-cookie providers", () => {
      expect(
        getProviderStatus(
          [{ provider: "chatgpt-web", authType: "cookie", isActive: true }],
          "chatgpt-web",
          "cookie",
        ),
      ).toBe("active");
      expect(
        getProviderStatus(
          [{ provider: "chatgpt-web", authType: "cookie", isActive: false }],
          "chatgpt-web",
          "cookie",
        ),
      ).toBe("deactivated");
      expect(
        getProviderStatus(
          [{ provider: "chatgpt-web", authType: "oauth" }],
          "chatgpt-web",
          "cookie",
        ),
      ).toBe("not-configured");
    });

    it("supports kiro dual auth scopes", () => {
      expect(
        getProviderStatus(
          [{ provider: "kiro", authType: "api_key", isActive: true }],
          "kiro",
          ["oauth", "apikey", "api_key"],
        ),
      ).toBe("active");
    });
  });
});
