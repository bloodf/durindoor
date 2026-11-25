import { describe, expect, it } from "vitest";
import { parseRateLimitEvidence } from "../../open-sse/utils/error.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("OmniRoute a10488825667eb847e83113d6eecf9bdc01863ed CodeBuddy dated 429 envelope", () => {
  const now = Date.parse("2026-11-25T00:00:00Z");
  const reset = now + 3600000;

  it.each([
    "resetTime", "reset_time", "resetAt", "reset_at", "resetsAt", "resets_at",
    "unlockTime", "unlock_time", "availableAt",
  ])("reads data.%s for CodeBuddy International only", (field) => {
    const bodyText = JSON.stringify({ code: 429, msg: "rate limited", data: { [field]: new Date(reset).toISOString() } });
    expect(parseRateLimitEvidence({ status: 429, bodyText, provider: "codebuddy-intl", now }))
      .toMatchObject({ resetAtMs: reset, source: "structured_body" });
    expect(parseRateLimitEvidence({ status: 429, bodyText, provider: "codebuddy-cn", now }).resetAtMs).toBeNull();
  });

  it("skips an unusable spelling and accepts a later epoch-seconds one", () => {
    const bodyText = JSON.stringify({ data: { resetTime: "", unlockTime: reset / 1000 } });
    expect(parseRateLimitEvidence({ status: 429, bodyText, provider: "codebuddy-intl", now }).resetAtMs).toBe(reset);
  });

  it("carries the dated envelope into the connection cooldown", () => {
    const bodyText = JSON.stringify({ data: { unlockTime: new Date(Date.now() + 600000).toISOString() } });
    const result = checkFallbackError(429, bodyText, 0, "codebuddy-intl");
    expect(result.scope).toBe("connection");
    expect(result.cooldownMs).toBeGreaterThan(590000);
  });
});
