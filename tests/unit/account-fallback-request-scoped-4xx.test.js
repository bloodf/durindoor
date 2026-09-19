// Regression: an unmatched 4xx (a request-scoped failure) used to hit the
// generic ERROR_RULES default (transient cooldown), which locked the account
// and — with a single connection — answered every other request in that
// window with a copy of the first error. A 400 "maximum context length" from
// one session therefore looked like the same failure in unrelated sessions.
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("checkFallbackError — request-scoped vs account-scoped 4xx", () => {
  it("does not cool the account down for an unmatched 400 caused by the request", () => {
    const result = checkFallbackError(400, JSON.stringify({
      error: {
        message: "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens",
        type: "invalid_request_error",
      },
    }));

    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
  });

  it("does not cool the account down for other unmatched 4xx statuses", () => {
    for (const status of [405, 409, 415, 422]) {
      const result = checkFallbackError(status, "unrelated request-scoped error");
      expect(result.shouldFallback).toBe(false);
      expect(result.cooldownMs).toBe(0);
    }
  });

  it("still falls back for account-scoped statuses", () => {
    for (const status of [401, 402, 403, 404, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
  });

  it("still honours rate-limit / quota wording on any 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});
