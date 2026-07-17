import { describe, expect, it } from "vitest";
import {
  ApiKeyExpiryValidationError,
  canonicalizeApiKeyExpiresAt,
  isApiKeyExpired,
  normalizeApiKeyExpiresAt,
} from "../../src/shared/utils/apiKeyExpiry.js";

describe("API-key expiry contract", () => {
  const now = Date.parse("2030-01-01T00:00:00.000Z");

  it("stores absolute timestamps as canonical UTC and supports never-expire", () => {
    expect(normalizeApiKeyExpiresAt(null, now)).toBeNull();
    expect(normalizeApiKeyExpiresAt("2030-01-02T03:00:00+03:00", now)).toBe("2030-01-02T00:00:00.000Z");
    expect(canonicalizeApiKeyExpiresAt("2029-12-31T19:00:00-05:00")).toBe("2030-01-01T00:00:00.000Z");
  });

  it.each([undefined, "", 42, "2030", "2030-01-02", "2030-01-02T00:00:00", "2030-02-30T00:00:00Z", "2030-04-31T00:00:00Z", "not-a-date"])(
    "rejects ambiguous or invalid input %j",
    (value) => expect(() => normalizeApiKeyExpiresAt(value, now)).toThrow(ApiKeyExpiryValidationError),
  );

  it("rejects past and exact-boundary writes", () => {
    expect(() => normalizeApiKeyExpiresAt("2029-12-31T23:59:59Z", now)).toThrow("future");
    expect(() => normalizeApiKeyExpiresAt("2030-01-01T00:00:00Z", now)).toThrow("future");
  });

  it("treats exact-boundary and malformed stored values as expired", () => {
    expect(isApiKeyExpired(null, now)).toBe(false);
    expect(isApiKeyExpired("2030-01-01T00:00:01Z", now)).toBe(false);
    expect(isApiKeyExpired("2030-01-01T00:00:00Z", now)).toBe(true);
    expect(isApiKeyExpired("malformed", now)).toBe(true);
    expect(isApiKeyExpired("", now)).toBe(true);
  });
});
