import { describe, expect, it } from "vitest";
import { connectionPage, togglePageSelection } from "../../src/app/(dashboard)/dashboard/providers/[id]/connectionPagination.js";

describe("bulk connection pagination", () => {
  const connections = Array.from({ length: 52 }, (_, i) => ({ id: String(i), name: `Account ${i}` }));

  it("selects and deselects only the current page while retaining other selections", () => {
    const first = connectionPage(connections, 1).items;
    const second = connectionPage(connections, 2).items;
    const selected = togglePageSelection(togglePageSelection([], first), second);
    expect(selected).toHaveLength(50);
    expect(togglePageSelection(selected, first)).toEqual(second.map(({ id }) => id));
  });

  it("retains hidden selections when selecting filtered results", () => {
    const filtered = connections.filter(({ name }) => name === "Account 51");
    expect(togglePageSelection(["0"], connectionPage(filtered, 1).items)).toEqual(["0", "51"]);
    expect(togglePageSelection(["0", "51"], filtered)).toEqual(["0"]);
    expect(togglePageSelection(["0"], [])).toEqual(["0"]);
  });

  it("clamps pages after results shrink and handles empty results", () => {
    expect(connectionPage(connections.slice(0, 26), 3)).toEqual({ page: 2, pageCount: 2, items: [connections[25]] });
    expect(connectionPage([], 3)).toEqual({ page: 1, pageCount: 1, items: [] });
  });
});
