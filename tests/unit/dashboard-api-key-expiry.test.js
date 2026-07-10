import { describe, expect, it } from "vitest";
import {
  API_KEY_EXPIRY_PRESETS,
  expiryFromSelection,
  expirySelectionFromValue,
  formatKeyExpiry,
  toLocalDateTimeInput,
} from "../../src/app/(dashboard)/dashboard/endpoint/apiKeyExpiry.js";

describe("dashboard API-key expiry helpers", () => {
  const now = Date.parse("2030-01-01T00:00:00.000Z");

  it("offers never, 1, 7, 30, 90, and custom choices", () => {
    expect(API_KEY_EXPIRY_PRESETS.map((item) => item.value)).toEqual(["never", "1", "7", "30", "90", "custom"]);
  });

  it.each([["1", 1], ["7", 7], ["30", 30], ["90", 90]])("converts the %s-day preset to UTC", (selection, days) => {
    expect(expiryFromSelection(selection, "", now)).toBe(new Date(now + (days * 86_400_000)).toISOString());
  });

  it("supports explicit clearing and validates custom local input", () => {
    expect(expiryFromSelection("never", "", now)).toBeNull();
    expect(() => expiryFromSelection("custom", "2030-02-30T12:00", now)).toThrow("future local date");
    const pastLocal = toLocalDateTimeInput(new Date(now - 60_000).toISOString());
    expect(() => expiryFromSelection("custom", pastLocal, now)).toThrow("future local date");
  });

  it("round-trips an existing expiry into edit state and includes dates in labels", () => {
    const state = expirySelectionFromValue("2030-01-02T00:00:00.000Z");
    expect(state.selection).toBe("custom");
    expect(state.customLocalValue).toMatch(/^2030-01-0[12]T\d{2}:\d{2}$/);
    expect(formatKeyExpiry("2029-12-31T00:00:00.000Z", now)).toMatchObject({ danger: true });
    expect(formatKeyExpiry("2029-12-31T00:00:00.000Z", now).text).toContain("Expired");
  });

  it("never presents malformed empty storage as non-expiring", () => {
    expect(expirySelectionFromValue("")).toEqual({ selection: "custom", customLocalValue: "" });
    expect(formatKeyExpiry("", now)).toEqual({ text: "Invalid expiry", danger: true });
    expect(formatKeyExpiry("2999-01-01T00:00:00", now)).toEqual({ text: "Invalid expiry", danger: true });
    expect(formatKeyExpiry("2999-02-30T00:00:00Z", now)).toEqual({ text: "Invalid expiry", danger: true });
  });
});
