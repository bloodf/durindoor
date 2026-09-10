// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import DataTable from "@/shared/ui/components/DataTable.jsx";
import Pagination from "@/shared/ui/components/Pagination.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const rows = [
  { id: "r-1", name: "Alpha", events: 2 },
  { id: "r-2", name: "Beta", events: 4 },
];
const columns = [
  { key: "name", label: "Name", rowHeader: true },
  { key: "events", label: "Events", align: "right" },
];

describe("Durin DS DataTable and Pagination", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps supplied rows intact and uses caption, row headers, and sort semantics", async () => {
    const onSort = vi.fn();
    await act(async () => {
      root.render(React.createElement(DataTable, {
        caption: "Server requests",
        columns: [columns[0], { ...columns[1], sortDirection: "descending", onSort }],
        rows,
        keyFn: (row) => row.id,
        pagination: { page: 1, pageCount: 25, total: 2402 },
      }));
    });

    const table = container.querySelector("table");
    expect(table.querySelector("caption").textContent).toBe("Server requests");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table.querySelector('th[scope="row"]').textContent).toBe("Alpha");
    const eventsHeader = Array.from(table.querySelectorAll("th")).find((header) => header.textContent.includes("Events"));
    expect(eventsHeader.getAttribute("aria-sort")).toBe("descending");
    eventsHeader.querySelector("button").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("2,402 results");
  });

  it("expands only when parent owns expansion state", async () => {
    let expandedKeys = [];
    const onExpandedRowKeysChange = vi.fn((keys) => {
      expandedKeys = keys;
    });
    const props = {
      columns,
      rows: rows.slice(0, 1),
      keyFn: (row) => row.id,
      expandedRowKeys: expandedKeys,
      onExpandedRowKeysChange,
      getRowLabel: (row) => row.name,
      renderExpandedRow: (row) => React.createElement("p", null, `${row.name} detail`),
    };

    await act(async () => {
      root.render(React.createElement(DataTable, props));
    });
    const toggle = container.querySelector('button[aria-label="Expand Alpha"]');
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onExpandedRowKeysChange).toHaveBeenCalledWith(["r-1"]);

    await act(async () => {
      root.render(React.createElement(DataTable, { ...props, expandedRowKeys: expandedKeys }));
    });
    expect(container.querySelector('button[aria-label="Collapse Alpha"]').getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Alpha detail");
  });

  it("renders frameless when embedded inside another surface", async () => {
    await act(async () => {
      root.render(React.createElement(DataTable, { caption: "Embedded rows", columns, rows, keyFn: (row) => row.id, framed: false }));
    });

    const wrapper = container.firstElementChild;
    // No nested frame: the bordered/rounded surface wrapper is gone, the
    // header inset background is dropped, and row hairlines carry structure.
    expect(wrapper.className).not.toContain("rounded-dd-lg");
    expect(wrapper.className).not.toContain("border-dd-border");
    expect(container.querySelector("thead").className).not.toContain("bg-dd-surface-2");
    expect(container.querySelector("tbody tr").className).toContain("border-dd-border-subtle");

    await act(async () => {
      root.render(React.createElement(DataTable, { caption: "Framed rows", columns, rows, keyFn: (row) => row.id }));
    });
    expect(container.firstElementChild.className).toContain("rounded-dd-lg border border-dd-border bg-dd-surface");
    expect(container.querySelector("thead").className).toContain("bg-dd-surface-2");
  });

  it("renders safe first-and-last pagination controls", async () => {
    const onPage = vi.fn();
    const onRowsPerPageChange = vi.fn();
    await act(async () => {
      root.render(React.createElement(Pagination, {
        page: 0,
        pageCount: 0,
        total: 0,
        rowsPerPage: 10,
        onPage,
        onRowsPerPageChange,
      }));
    });

    const previous = container.querySelector('button[aria-label="Previous page"]');
    const next = container.querySelector('button[aria-label="Next page"]');
    const select = container.querySelector('select[aria-label="Rows per page"]');
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    expect(container.textContent).toContain("0 results");

    await act(async () => {
      select.value = "all";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onRowsPerPageChange).toHaveBeenCalledWith("all");
    expect(onPage).not.toHaveBeenCalled();
  });
});
