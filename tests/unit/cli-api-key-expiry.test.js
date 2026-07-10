import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { EXPIRY_OPTIONS, expiryFromChoice, formatExpiry, isExpired } = require("../../cli/src/cli/utils/apiKeyExpiry.js");

describe("CLI API-key expiry helpers", () => {
  const now = Date.parse("2030-01-01T00:00:00.000Z");

  it("offers the documented preset set and clearing", () => {
    expect(EXPIRY_OPTIONS.map((item) => item.value)).toEqual(["never", "1", "7", "30", "90", "custom"]);
    expect(expiryFromChoice(EXPIRY_OPTIONS[0], "", now)).toBeNull();
  });

  it("converts presets and rejects invalid custom local time", () => {
    expect(expiryFromChoice(EXPIRY_OPTIONS[2], "", now)).toBe("2030-01-08T00:00:00.000Z");
    expect(() => expiryFromChoice(EXPIRY_OPTIONS.at(-1), "2030-02-30T10:00", now)).toThrow("future local date");
  });

  it("shows future and expired dates without exposing a credential", () => {
    const render = (value) => `date:${value}`;
    expect(formatExpiry("2030-01-02T00:00:00.000Z", now, render)).toContain("Expires: date:");
    expect(formatExpiry("2029-12-31T00:00:00.000Z", now, render)).toContain("Expired: date:");
  });

  it("never presents malformed empty storage as non-expiring", () => {
    expect(formatExpiry("", now, (value) => value)).toBe("Invalid expiry");
    expect(formatExpiry("2999-01-01T00:00:00", now, (value) => value)).toBe("Invalid expiry");
    expect(formatExpiry("2999-02-30T00:00:00Z", now, (value) => value)).toBe("Invalid expiry");
    expect(isExpired("", now)).toBe(true);
  });
});
