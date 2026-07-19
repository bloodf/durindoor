import { describe, expect, it } from "vitest";
import { clampPage, paginate } from "@/shared/hooks/usePagination.js";

describe("client pagination helpers", () => {
  it("slices pages and clamps page bounds", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(clampPage(9, 3)).toBe(3);
    expect(clampPage(0, 3)).toBe(1);
  });
});
