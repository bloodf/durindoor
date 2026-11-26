import { describe, expect, it } from "vitest";
import { githubRateLimit } from "../../open-sse/handlers/chatCore/githubRateLimit.js";
import { parseRateLimitEvidence } from "../../open-sse/utils/error.js";

const now = Date.UTC(2026, 0, 1);
// Date.parse reads each of these as a date, "-3000" as one a thousand years ahead.
const nonPositive = ["-1", "-0", "-3000", "-9999", "  -3000  "];

describe("OmniRoute #20146 - nonpositive numeric Retry-After", () => {
  it.each(nonPositive)("gives no header cooldown for %j", (value) => {
    const evidence = parseRateLimitEvidence({
      status: 429,
      headers: new Headers({ "retry-after": value }),
      now,
      maxDelayMs: Number.MAX_SAFE_INTEGER,
    });

    expect(evidence?.resetAtMs ?? null).toBeNull();
  });

  it.each(nonPositive)("records no GitHub reset time for %j", (value) => {
    expect(githubRateLimit(new Headers({ "retry-after": value }), now).resetAt).toBeNull();
  });

  it("still reads positive seconds and an HTTP date", () => {
    const later = new Date(now + 90_000).toUTCString();

    for (const value of ["90", later]) {
      const headers = new Headers({ "retry-after": value });
      expect(parseRateLimitEvidence({ status: 429, headers, now }).resetAtMs).toBe(now + 90_000);
      expect(githubRateLimit(headers, now).resetAt).toBe(new Date(now + 90_000).toISOString());
    }
  });
});
