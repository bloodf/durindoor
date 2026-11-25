import { describe, expect, it } from "vitest";
import { parseRateLimitEvidence } from "../../open-sse/utils/error.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("OmniRoute fb5fe2a provider-scoped data reset", () => {
  it("honors CodeBuddy's reset time without treating other providers' data as retry evidence", () => {
    const now = Date.now();
    const bodyText = JSON.stringify({ data: { resetTime: new Date(now + 600000).toISOString(), retry_after: 600 } });
    expect(parseRateLimitEvidence({ status: 429, bodyText, provider: "codebuddy-intl", now }).resetAtMs).toBe(now + 600000);
    expect(parseRateLimitEvidence({ status: 429, bodyText, provider: "other", now }).resetAtMs).toBeNull();
    expect(checkFallbackError(429, bodyText, 0, "codebuddy-intl").cooldownMs).toBeGreaterThan(590000);
  });
});
