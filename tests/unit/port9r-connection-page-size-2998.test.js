import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connectionPage, togglePageSelection } from "../../src/app/(dashboard)/dashboard/providers/[id]/connectionPagination.js";

 describe("connection page size", () => {
  it("paginates at the selected size and keeps selections from other pages", () => {
    const connections = Array.from({ length: 30 }, (_, id) => ({ id }));
    const page = connectionPage(connections, 2, 10);
    expect(page.items.map(({ id }) => id)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(togglePageSelection([1], page.items)).toEqual([1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("wires the size selector to pagination and resets the page", () => {
    const page = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url), "utf8");
    expect(page).toContain("connectionPage(visibleConnections, connectionPageNumber, connectionPageSize)");
    expect(page).toContain("setConnectionPageSize(Number(event.target.value)); setConnectionPageNumber(1)");
  });
});
