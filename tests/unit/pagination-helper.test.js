import { describe, expect, it } from "vitest";
import { clampPage, paginate } from "@/shared/hooks/usePagination.js";

describe("client pagination helpers", () => {
  it("slices pages and clamps page bounds", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(clampPage(9, 3)).toBe(3);
    expect(clampPage(0, 3)).toBe(1);
  });

  it("returns every item only on first page when page size is all", () => {
    expect(paginate([1, 2, 3], 1, "all")).toEqual([1, 2, 3]);
    expect(paginate([1, 2, 3], 2, "all")).toEqual([]);
  });
});
