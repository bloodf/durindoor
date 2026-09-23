import { describe, expect, it } from "vitest";
import { timingSafeCompare } from "../../src/shared/utils/timingSafeCompare.js";

describe("timingSafeCompare", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeCompare("sk-abc123", "sk-abc123")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(timingSafeCompare("sk-abc123", "sk-abc124")).toBe(false);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(() => timingSafeCompare("short", "a-much-longer-secret")).not.toThrow();
    expect(timingSafeCompare("short", "a-much-longer-secret")).toBe(false);
    expect(timingSafeCompare("a-much-longer-secret", "short")).toBe(false);
  });

  it("returns false when either side is empty", () => {
    expect(timingSafeCompare("", "")).toBe(true);
    expect(timingSafeCompare("", "secret")).toBe(false);
    expect(timingSafeCompare("secret", "")).toBe(false);
  });

  it("returns false for non-string input instead of throwing", () => {
    expect(timingSafeCompare(null, "secret")).toBe(false);
    expect(timingSafeCompare(undefined, "secret")).toBe(false);
    expect(timingSafeCompare(123, "123")).toBe(false);
    expect(timingSafeCompare({}, "secret")).toBe(false);
    expect(timingSafeCompare("secret", null)).toBe(false);
  });

  it("is case sensitive", () => {
    expect(timingSafeCompare("Secret", "secret")).toBe(false);
  });
});
