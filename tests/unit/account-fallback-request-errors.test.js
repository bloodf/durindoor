import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("account fallback request-error classification", () => {
  it("does not rotate accounts for deterministic 400 and 422 request errors", () => {
    expect(checkFallbackError(400, "Improperly formed request")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
    expect(checkFallbackError(422, "Failed to deserialize request")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("still rotates accounts for 401 auth and 429 quota errors", () => {
    expect(checkFallbackError(401, "Invalid API key").shouldFallback).toBe(true);
    expect(checkFallbackError(429, "Rate limit reached").shouldFallback).toBe(true);
  });
});
