import { describe, expect, it } from "vitest";
import { generateShortId } from "@/lib/tunnel/shared/state.js";

const CHARSET = "abcdefghijklmnpqrstuvwxyz23456789";

describe("tunnel short id contract", () => {
  it("keeps its six-character alphabet", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateShortId()).toMatch(/^[abcdefghijklmnpqrstuvwxyz23456789]{6}$/);
    }
  });

  it("keeps excluding characters that are easy to misread aloud", () => {
    const ids = Array.from({ length: 500 }, generateShortId).join("");
    for (const char of ["o", "0", "1"]) expect(ids).not.toContain(char);
  });

  it("does not get stuck in a short cycle", () => {
    const ids = new Set(Array.from({ length: 5_000 }, generateShortId));
    expect(ids.size).toBeGreaterThan(4_990);
  });

  it("can reach the whole alphabet", () => {
    const seen = new Set(Array.from({ length: 3_000 }, generateShortId).join(""));
    expect(seen.size).toBe(CHARSET.length);
  });
});
