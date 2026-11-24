// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { getByRole } from "@testing-library/dom";
import Card from "../../src/shared/components/Card.js";
import Drawer from "../../src/shared/components/Drawer.js";
import Pagination from "../../src/shared/components/Pagination.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
async function render(element) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(element));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  root = null;
  delete document.documentElement.dataset.ui;
});

it("preserves submit actions placed in a legacy Card", async () => {
  const submit = vi.fn((event) => event.preventDefault());
  await render(React.createElement("form", { onSubmit: submit },
    React.createElement(Card, { title: "Account", action: React.createElement("button", { type: "submit" }, "Save") })));
  const button = getByRole(host, "button", { name: "Save" });
  expect(button.type).toBe("submit");
  await act(async () => button.click());
  expect(submit).toHaveBeenCalledOnce();
});

for (const enabled of [false, true]) {
  it(`preserves legacy Card heading and action with V5 ${enabled}`, async () => {
    document.documentElement.dataset.ui = enabled ? "v5" : "";
    const click = vi.fn();
    await render(React.createElement(Card, { title: "Account", subtitle: "Details", action: React.createElement("button", { type: "button", onClick: click }, "Edit") }, "Content"));
    if (!enabled) expect(host.innerHTML).toMatchSnapshot();
    expect(getByRole(host, "heading", { name: "Account" }).tagName).toBe("H3");
    const button = getByRole(host, "button", { name: "Edit" });
    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(click).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Details");
  });

  it(`preserves legacy Drawer dialog and close action with V5 ${enabled}`, async () => {
    document.documentElement.dataset.ui = enabled ? "v5" : "";
    const close = vi.fn();
    await render(React.createElement(Drawer, { isOpen: true, onClose: close, title: "Details", width: "sm" }, "Body"));
    const dialog = getByRole(document.body, "dialog", { name: "Details" });
    if (!enabled) expect(dialog.outerHTML).toMatchSnapshot();
    expect(dialog.textContent).toContain("Body");
    const button = getByRole(dialog, "button", { name: /close/i });
    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it(`preserves legacy Pagination controls with V5 ${enabled}`, async () => {
    document.documentElement.dataset.ui = enabled ? "v5" : "";
    const change = vi.fn();
    const sizeChange = vi.fn();
    await render(React.createElement(Pagination, { currentPage: 1, pageSize: 20, totalItems: 45, onPageChange: change, onPageSizeChange: sizeChange }));
    const nav = getByRole(host, "navigation", { name: "Pagination" });
    if (!enabled) expect(host.innerHTML).toMatchSnapshot();
    expect(host.textContent).toContain("Showing 1 to 20 of 45 results");
    expect(getByRole(nav, "button", { name: "Previous page" }).disabled).toBe(true);
    const next = getByRole(nav, "button", { name: "Next page" });
    expect(next.type).toBe("button");
    expect(next.disabled).toBe(false);
    await act(async () => next.click());
    expect(change).toHaveBeenCalledWith(2);
    const select = getByRole(nav, "combobox", { name: "Rows per page" });
    expect(select.value).toBe("20");
    await act(async () => { select.value = "all"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(sizeChange).toHaveBeenCalledWith("all");
  });
}
