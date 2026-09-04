import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("account fallback request-error classification", () => {
  it("does not rotate accounts for deterministic 400 and 422 request errors", () => {
    expect(checkFallbackError(400, "Improperly formed request")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      scope: null,
    });
    expect(checkFallbackError(422, "Failed to deserialize request")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      scope: null,
    });
  });

  it("keeps external HTTP 499 terminal", () => {
    expect(checkFallbackError(499, "Client closed request")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      scope: null,
    });
  });

  it("still rotates accounts for 401 auth and 429 quota errors", () => {
    expect(checkFallbackError(401, "Invalid API key").shouldFallback).toBe(true);
    expect(checkFallbackError(429, "Rate limit reached").shouldFallback).toBe(true);
  });

  it.each([
    "ModelError: model does not exist",
    "model gpt-999 is not supported",
    "model not found",
    "model gpt-999 is not allowed on this credential",
    "model gpt-999 is not allowed for this key",
  ])("does not rotate or cool a wrong-model 401: %s", (message) => {
    expect(checkFallbackError(401, message)).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      scope: null,
    });
  });


  it("still rotates/cools an unrelated ModelError401 (temporary provider failure)", () => {
    const result = checkFallbackError(401, "ModelError401: temporary provider failure");
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("preserves lock 401/403 as terminal (no rotation, no cooldown)", () => {
    expect(checkFallbackError(401, "Invalid API key")).toEqual({
      shouldFallback: true, cooldownMs: expect.any(Number), scope: null
    });
    expect(checkFallbackError(403, "Forbidden - account locked")).toMatchObject({
      shouldFallback: true, cooldownMs: expect.any(Number), scope: null
    });
  });
});
