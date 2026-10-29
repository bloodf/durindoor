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

  // Port of 9router b82f5c4 / review on #1364: credit exhaustion uses the same
  // long terminal cooldown as `insufficient balance` so OpenRouter 402 stays
  // on main's 120s lock (not a 2s backoff) while 400 remaps still rotate.
  it.each([
    "You have insufficient credits to make this request. Please purchase more credits to continue using the service.",
    "INSUFFICIENT CREDITS",
    "Insufficient credit balance",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    "CREDIT BALANCE IS TOO LOW",
  ])("falls back with a long terminal cooldown for a 400 credit error: %s", (message) => {
    expect(checkFallbackError(400, message)).toEqual({
      shouldFallback: true, cooldownMs: 120000, terminal: true, scope: null,
    });
    expect(checkFallbackError(400, message, 1)).toEqual({
      shouldFallback: true, cooldownMs: 120000, terminal: true, scope: null,
    });
  });

  it("keeps OpenRouter-style 402 insufficient credits on main's terminal long cooldown", () => {
    // Same body OpenRouter documents for payment_required; must match main's
    // { status: 402, cooldownMs: COOLDOWN.long, terminal: true } outcome even
    // though the text rule sits above the status rule in ERROR_RULES.
    expect(checkFallbackError(
      402,
      JSON.stringify({
        error: {
          message: "Insufficient credits. Add more using https://openrouter.ai/settings/credits",
          code: 402,
        },
      }),
    )).toEqual({
      shouldFallback: true, cooldownMs: 120000, terminal: true, scope: null,
    });
  });

  it("does not fall back for an ordinary bad request", () => {
    expect(checkFallbackError(400, "Bad request")).toEqual({
      shouldFallback: false, cooldownMs: 0, scope: null,
    });
  });

  it("does not rotate for a normal Anthropic invalid_request_error envelope", () => {
    expect(checkFallbackError(400, JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "messages.0: Field required",
      },
    }))).toEqual({
      shouldFallback: false, cooldownMs: 0, scope: null,
    });
  });

  it("rotates for Anthropic credit exhaustion typed as invalid_request_error", () => {
    expect(checkFallbackError(400, JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
    }))).toEqual({
      shouldFallback: true, cooldownMs: 120000, terminal: true, scope: null,
    });
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});
