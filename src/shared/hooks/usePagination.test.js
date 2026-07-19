import { describe, it, expect } from "vitest";
import { paginate, clampPage } from "./usePagination.js";

describe("paginate", () => {
  it("returns the correct slice for a 1-based page", () => {
    const items = Array.from({ length: 45 }, (_, i) => i + 1);
    expect(paginate(items, 1, 20)).toEqual(items.slice(0, 20));
    expect(paginate(items, 2, 20)).toEqual(items.slice(20, 40));
    expect(paginate(items, 3, 20)).toEqual(items.slice(40, 60));
  });

  it("returns an empty array when page is beyond the collection", () => {
    expect(paginate([1, 2, 3], 5, 20)).toEqual([]);
  });

  it("handles empty input", () => {
    expect(paginate([], 1, 20)).toEqual([]);
  });
});

describe("clampPage", () => {
  it("keeps valid pages inside the range", () => {
    expect(clampPage(1, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(5, 5)).toBe(5);
  });

  it("clamps below 1 to 1", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-10, 5)).toBe(1);
  });

  it("clamps above totalPages to the last page", () => {
    expect(clampPage(10, 5)).toBe(5);
  });

  it("uses page 1 when there are no pages", () => {
    expect(clampPage(5, 0)).toBe(1);
  });
});
