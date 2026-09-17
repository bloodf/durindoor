import { describe, it, expect, vi, afterEach } from "vitest";
import { claudeProfileFields, fetchClaudeProfile } from "../../src/lib/oauth/providerHelpers.js";
import { claudePlanName } from "../../open-sse/services/usage/claude.js";
import { sanitizeProviderConnectionForClient } from "../../src/lib/providers/sanitizeProviderConnectionForClient.js";

const PROFILE = {
  account: {
    uuid: "acc-1",
    email: "user@example.com",
    display_name: "Example User",
    has_claude_max: true,
    has_claude_pro: false,
  },
  organization: {
    uuid: "org-1",
    name: "Example Org",
    organization_type: "claude_max",
    rate_limit_tier: "default_claude_max_20x",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claudeProfileFields", () => {
  it("maps the profile onto connection fields", () => {
    expect(claudeProfileFields(PROFILE)).toEqual({
      email: "user@example.com",
      displayName: "Example User",
      providerSpecificData: {
        claudeAccountUuid: "acc-1",
        claudeHasMax: true,
        claudeHasPro: false,
        claudeOrgUuid: "org-1",
        claudeOrgName: "Example Org",
        claudeOrgType: "claude_max",
        claudeRateLimitTier: "default_claude_max_20x",
      },
    });
  });

  // `has_claude_pro: false` is meaningful — it says the account is NOT pro. A
  // truthiness check would drop it and make "unknown" indistinguishable from "no".
  it("keeps a false boolean flag rather than dropping it", () => {
    const fields = claudeProfileFields({ account: { has_claude_pro: false } });
    expect(fields.providerSpecificData).toEqual({ claudeHasPro: false });
  });

  it("returns an empty object for a missing or empty profile", () => {
    expect(claudeProfileFields(null)).toEqual({});
    expect(claudeProfileFields(undefined)).toEqual({});
    expect(claudeProfileFields({})).toEqual({});
  });
});

describe("fetchClaudeProfile", () => {
  it("returns null instead of throwing when the profile call fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 })));
    await expect(fetchClaudeProfile("tok", "https://example.test/profile")).resolves.toBeNull();
  });

  it("returns null without a token or url, and makes no request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchClaudeProfile("", "https://example.test/profile")).resolves.toBeNull();
    await expect(fetchClaudeProfile("tok", "")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A strict proxy pool is a security boundary: a transport failure must abort
  // rather than silently fall back to a direct egress, matching fetchKiroProfileArn.
  it("propagates a failure when a strict proxy pool is selected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502 })));
    await expect(
      fetchClaudeProfile("tok", "https://example.test/profile", { strictProxy: true }),
    ).rejects.toThrow(/Claude profile fetch failed/);
  });
});

describe("claudePlanName", () => {
  it("prefers the rate limit tier, including its multiplier", () => {
    expect(claudePlanName({ claudeRateLimitTier: "default_claude_max_20x" })).toBe("Claude Max 20x");
    expect(claudePlanName({ claudeRateLimitTier: "default_claude_max_5x" })).toBe("Claude Max 5x");
    expect(claudePlanName({ claudeRateLimitTier: "default_claude_pro" })).toBe("Claude Pro");
  });

  it("falls back to organization type, then the account flags", () => {
    expect(claudePlanName({ claudeOrgType: "claude_team" })).toBe("Claude Team");
    expect(claudePlanName({ claudeHasMax: true })).toBe("Claude Max");
    expect(claudePlanName({ claudeHasPro: true })).toBe("Claude Pro");
  });

  // A connection with no profile data must read exactly as it did before.
  it("keeps the historical default when nothing is known", () => {
    expect(claudePlanName(null)).toBe("Claude Code");
    expect(claudePlanName({})).toBe("Claude Code");
  });
});

// The profile carries an account email and org identifiers. Email and display
// name are already client-visible fields; the identifiers must not become so.
describe("profile data exposure", () => {
  it("does not leak claude org identifiers to the client", () => {
    const sanitized = sanitizeProviderConnectionForClient({
      id: "c1",
      provider: "claude",
      authType: "oauth",
      email: "user@example.com",
      displayName: "Example User",
      accessToken: "secret-token",
      providerSpecificData: claudeProfileFields(PROFILE).providerSpecificData,
    });
    expect(sanitized.email).toBe("user@example.com");
    expect(sanitized.providerSpecificData ?? {}).toEqual({});
    expect(sanitized.accessToken).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain("org-1");
    expect(JSON.stringify(sanitized)).not.toContain("secret-token");
  });
});
