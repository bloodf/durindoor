// @vitest-environment happy-dom
// Exercise the mounted production page with the existing modal-spacing fixtures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within, fireEvent } from "@testing-library/dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/components", () => ({
  ModelSelectModal: () => null,
  CapacityBadges: () => null,
  CardSkeleton: () => null,
}));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/components/DocsLink", () => ({ default: () => null }));
vi.mock("../../src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.jsx", () => ({ default: () => null }));

import ProductionCombosPage from "../../src/app/(dashboard)/dashboard/combos/page.js";

const json = (body) => ({ ok: true, status: 200, json: async () => body });
const click = async (button) => { await act(async () => button.click()); };
const button = (host, name) => within(host).getByRole("button", { name, exact: true });

describe("production single combo delete feedback", () => {
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["HTTP 500", "network rejection"])("retains the row after %s and completes a successful retry", async (failure) => {
    let resolveDelete;
    let rejectDelete;
    const combo = { id: "combo-1", name: "retained-combo", models: [] };
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (options?.method === "DELETE") {
        return new Promise((resolve, reject) => { resolveDelete = resolve; rejectDelete = reject; });
      }
      if (url === "/api/combos") return json({ combos: [combo] });
      if (String(url).startsWith("/api/providers")) return json({ connections: [] });
      if (String(url).startsWith("/api/connection-groups")) return json({ groups: [] });
      if (String(url).startsWith("/api/models/alias")) return json({ aliases: {} });
      return json({});
    }));
    const deletes = () => fetch.mock.calls.filter(([, options]) => options?.method === "DELETE");
    const patches = () => fetch.mock.calls.filter(([, options]) => options?.method === "PATCH");
    await act(async () => { root.render(React.createElement(ProductionCombosPage)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(within(container).getByText("retained-combo").textContent).toBe("retained-combo");
    await click(button(container, "Delete"));
    const dialog = document.body.querySelector("dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Delete combo "retained-combo"?');
    const confirm = button(dialog, "Confirm");
    // Two same-turn clicks must still issue only one delete.
    await act(async () => { confirm.click(); confirm.click(); });
    expect(deletes()).toEqual([["/api/combos/combo-1", { method: "DELETE" }]]);
    expect(confirm.disabled).toBe(true);
    expect(button(dialog, "Cancel").disabled).toBe(true);
    await click(button(dialog, "Cancel"));
    await act(async () => { fireEvent(dialog, new Event("cancel", { cancelable: true })); });
    expect(dialog.open).toBe(true);
    expect(within(container).getByText("retained-combo").textContent).toBe("retained-combo");
    await act(async () => {
      if (failure === "HTTP 500") resolveDelete({ ok: false, status: 500, json: async () => ({ error: "Server error" }) });
      else rejectDelete(new Error("Offline"));
    });
    expect(document.body.querySelector("dialog")).toBe(dialog);
    expect(dialog.open).toBe(true);
    expect(within(dialog).getByRole("alert").textContent).toBe("Failed to delete combo. Please try again.");
    expect(within(container).getByText("retained-combo").textContent).toBe("retained-combo");
    expect(patches()).toEqual([]);
    expect(confirm.disabled).toBe(false);
    expect(button(dialog, "Cancel").disabled).toBe(false);
    await click(confirm);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(confirm.disabled).toBe(true);
    expect(deletes()).toEqual([
      ["/api/combos/combo-1", { method: "DELETE" }],
      ["/api/combos/combo-1", { method: "DELETE" }],
    ]);
    await act(async () => { resolveDelete(json({ success: true })); });
    expect(document.body.querySelector("dialog")).toBeNull();
    expect(within(container).queryByText("retained-combo")).toBeNull();
    expect(within(container).getByText("No combos yet").textContent).toBe("No combos yet");
    expect(patches()).toHaveLength(1);
  });
});
