/**
 * Regression: #2315 — an echoed client model id in a 400 must not bench every
 * shared account. Text rules match the provider's own message/code with the
 * requested model (and provider-stripped form) stripped first.
 */
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import {
  CLIENT_REQUEST_FALLBACK_SCOPE,
  resolveFallbackModelScope,
} from "../../open-sse/services/fallbackScope.js";

describe("review-m-fallback-echo (#2315)", () => {
  it("does not lock the account for OpenRouter 400 echoing a billing-phrase model id", () => {
    const body = JSON.stringify({
      error: { message: "x/余额不足 is not a valid model ID" },
    });
    const result = checkFallbackError(400, body, 0, "openrouter");
    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
    expect(result.terminal).toBeUndefined();
  });

  it("does not treat capacity/overloaded substrings inside the echoed model id as quota", () => {
    const capacity = checkFallbackError(
      400,
      JSON.stringify({ error: { message: "my-capacity-model is not a valid model ID" } }),
      0,
      "openrouter",
    );
    expect(capacity.shouldFallback).toBe(false);
    expect(capacity.terminal).toBeUndefined();

    // Model id alone would match "overloaded"; stripping the echoed request
    // value (and the wrong-model phrase) must leave the account unlocked.
    const overloaded = checkFallbackError(
      400,
      JSON.stringify({ error: { message: "openrouter/overloaded-x is not a valid model ID" } }),
      0,
      "openrouter",
      null,
      null,
      "openrouter/overloaded-x",
    );
    expect(overloaded.shouldFallback).toBe(false);
    expect(overloaded.terminal).toBeUndefined();
  });

  it("strips a passed model id from provider text even without a wrong-model phrase", () => {
    const result = checkFallbackError(
      400,
      JSON.stringify({ error: { message: "Rejected request for model x/余额不足" } }),
      0,
      "openrouter",
      null,
      null,
      "x/余额不足",
    );
    expect(result.shouldFallback).toBe(false);
    expect(result.terminal).toBeUndefined();
  });

  it("still terminals a real 400 billing phrase that is not an echoed model id", () => {
    expect(checkFallbackError(400, "You have insufficient credits to make this request")).toEqual({
      shouldFallback: true,
      cooldownMs: 120000,
      terminal: true,
      scope: null,
    });
    expect(checkFallbackError(400, "余额不足，请充值后再试")).toMatchObject({
      shouldFallback: true,
      terminal: true,
    });
  });

  it("keeps a client-caused unknown/passthrough model off the account-wide scope", () => {
    expect(resolveFallbackModelScope("openrouter", "x/余额不足")).toBeNull();
    expect(
      resolveFallbackModelScope("openrouter", "x/余额不足", { clientError: true }),
    ).toBe(CLIENT_REQUEST_FALLBACK_SCOPE);
    expect(
      resolveFallbackModelScope("openrouter", "x/余额不足", { clientError: true }),
    ).not.toBeNull();

    const result = checkFallbackError(
      400,
      "temporary capacity issue for this request shape",
      0,
      "openrouter",
      null,
      null,
      "x/totally-unknown-passthrough",
    );
    expect(result).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      scope: null,
      requestScoped: true,
    });
  });
});
