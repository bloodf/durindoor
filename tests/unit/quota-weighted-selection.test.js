import { describe, expect, it, vi } from "vitest";
import { pickWeightedIndex, pickQuotaWeightedConnection } from "../../src/shared/services/quotaSelection.js";

function comparable(id, effectiveRatio) {
  return { value: { id }, quotaDecision: { comparable: true, effectiveRatio } };
}

describe("pickWeightedIndex", () => {
  it("picks the first cumulative weight strictly greater than r", () => {
    // weights [1, 3, 6] -> cumulative [1, 4, 10]
    expect(pickWeightedIndex([1, 3, 6], 0)).toBe(0);
    expect(pickWeightedIndex([1, 3, 6], 0.5)).toBe(0);
    expect(pickWeightedIndex([1, 3, 6], 1)).toBe(1);
    expect(pickWeightedIndex([1, 3, 6], 3.9)).toBe(1);
    expect(pickWeightedIndex([1, 3, 6], 4)).toBe(2);
    expect(pickWeightedIndex([1, 3, 6], 9.99)).toBe(2);
  });

  it("skips zero/negative weights so r=0 never lands on a leading zero slot", () => {
    expect(pickWeightedIndex([0, 5], 0)).toBe(1);
    expect(pickWeightedIndex([-1, 5], 0)).toBe(1);
  });

  it("returns null when every weight is non-positive", () => {
    expect(pickWeightedIndex([0, 0, -1], 0)).toBeNull();
    expect(pickWeightedIndex([], 0)).toBeNull();
  });
});

describe("pickQuotaWeightedConnection", () => {
  it("falls back to ranked[0] when nothing is quota-comparable", () => {
    const ranked = [{ value: { id: "a" }, quotaDecision: { comparable: false } }];
    expect(pickQuotaWeightedConnection(ranked).id).toBe("a");
  });

  it("returns null for an empty pool", () => {
    expect(pickQuotaWeightedConnection([])).toBeNull();
  });

  it("draws proportionally to leftover quota", () => {
    const ranked = [comparable("high", 0.9), comparable("low", 0.1)];
    const randomSpy = vi.spyOn(Math, "random");
    try {
      randomSpy.mockReturnValue(0); // r=0 -> first positive weight (high, since it's listed first)
      expect(pickQuotaWeightedConnection(ranked).id).toBe("high");
      randomSpy.mockReturnValue(0.99); // r close to sum -> last account (low)
      expect(pickQuotaWeightedConnection(ranked).id).toBe("low");
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("draws only from the floor pool when every comparable account is already thin", () => {
    const ranked = [comparable("a", 0.005), comparable("b", 0.008)];
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const picked = pickQuotaWeightedConnection(ranked, { floorPercent: 1 });
      expect(["a", "b"]).toContain(picked.id);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("excludes an account with zero leftover quota from the draw", () => {
    const ranked = [comparable("empty", 0), comparable("has-quota", 0.5)];
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(pickQuotaWeightedConnection(ranked).id).toBe("has-quota");
    } finally {
      randomSpy.mockRestore();
    }
  });
});
