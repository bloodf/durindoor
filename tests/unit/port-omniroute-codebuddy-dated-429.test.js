import { describe, expect, it, vi } from "vitest";
import { applyErrorState, checkFallbackError, isAccountUnavailable } from "../../open-sse/services/accountFallback.js";

describe("OmniRoute ce3d86939c3541860b1336e02b966c0c40b71e05 CodeBuddy dated 429", () => {
  it("keeps the account unavailable until its stated UTC reset", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-25T00:00:00Z"));
      const message = "usage exceeds frequency limit, but don't worry, your usage will reset at 2026-11-25 09:17:44";
      expect(checkFallbackError(429, message, 0, "codebuddy-intl").scope).toBe("connection");
      const account = applyErrorState({}, 429, message, "codebuddy-intl");
      expect(account.rateLimitedUntil).toBe("2026-11-25T09:17:44.000Z");
      vi.setSystemTime(new Date("2026-11-25T09:17:43Z"));
      expect(isAccountUnavailable(account.rateLimitedUntil)).toBe(true);
      vi.setSystemTime(new Date("2026-11-25T09:17:44Z"));
      expect(isAccountUnavailable(account.rateLimitedUntil)).toBe(false);
      expect(checkFallbackError(429, message, 0, "codebuddy-cn").cooldownMs).toBeLessThan(60000);
    } finally {
      vi.useRealTimers();
    }
  });
});
