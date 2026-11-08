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

  it.each([
    ["all HTTP failures", false, false],
    ["mixed success and HTTP failure", true, false],
    ["mixed success and network rejection", true, true],
    ["all network rejections", false, true],
  ])("reconciles bulk %s and retries only remaining IDs", async (_, firstSucceeds, networkFailure) => {
    const combos = [
      { id: "A", name: "combo-a", models: [] },
      { id: "B", name: "combo-b", models: [] },
    ];
    const strategies = {
      "combo-a": { fallbackStrategy: "round-robin" },
      "combo-b": { fallbackStrategy: "random" },
      unrelated: { fallbackStrategy: "round-robin" },
    };
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (options?.method === "DELETE") {
        return new Promise((resolve, reject) => { requests.push({ url, resolve, reject }); });
      }
      if (url === "/api/combos") return json({ combos });
      if (url === "/api/settings") return json({ comboStrategies: strategies });
      if (String(url).startsWith("/api/providers")) return json({ connections: [] });
      if (String(url).startsWith("/api/connection-groups")) return json({ groups: [] });
      if (String(url).startsWith("/api/models/alias")) return json({ aliases: {} });
      return json({});
    }));
    const deletes = () => fetch.mock.calls.filter(([, options]) => options?.method === "DELETE");
    const payloads = () => fetch.mock.calls.filter(([, options]) => options?.method === "PATCH")
      .map(([, options]) => JSON.parse(options.body));
    await act(async () => { root.render(React.createElement(ProductionCombosPage)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await click(within(container).getByRole("checkbox", { name: "Select combo-a" }));
    await click(within(container).getByRole("checkbox", { name: "Select combo-b" }));
    await click(button(container, "Delete (2)"));
    const dialog = document.body.querySelector("dialog");
    const confirm = button(dialog, "Delete");
    await act(async () => { confirm.click(); confirm.click(); });
    expect(deletes()).toEqual([
      ["/api/combos/A", { method: "DELETE" }],
      ["/api/combos/B", { method: "DELETE" }],
    ]);
    expect(confirm.disabled).toBe(true);
    expect(button(dialog, "Cancel").disabled).toBe(true);
    await click(button(dialog, "Cancel"));
    await act(async () => { fireEvent(dialog, new Event("cancel", { cancelable: true })); });
    expect(dialog.open).toBe(true);
    // A rejection must not finish the batch before the other request settles.
    await act(async () => {
      if (networkFailure) requests[1].reject(new Error("Offline"));
      else requests[1].resolve({ ok: false, status: 500 });
    });
    expect(confirm.disabled).toBe(true);
    expect(payloads()).toEqual([]);
    expect(within(container).getByText("combo-a").textContent).toBe("combo-a");
    await act(async () => {
      if (firstSucceeds) requests[0].resolve(json({ success: true }));
      else if (networkFailure) requests[0].reject(new Error("Offline"));
      else requests[0].resolve({ ok: false, status: 500 });
    });
    expect(dialog.open).toBe(true);
    expect(within(dialog).getByRole("alert").textContent).toBe(firstSucceeds
      ? "1 combo could not be deleted. Please try again."
      : "2 combos could not be deleted. Please try again.");
    expect(within(container).getByRole("checkbox", { name: "Select combo-b" }).checked).toBe(true);
    expect(within(container).getByText("combo-b").textContent).toBe("combo-b");
    if (firstSucceeds) {
      expect(within(container).queryByText("combo-a")).toBeNull();
      expect(payloads()).toEqual([{ comboStrategies: {
        "combo-b": { fallbackStrategy: "random" },
        unrelated: { fallbackStrategy: "round-robin" },
      } }]);
    } else {
      expect(within(container).getByRole("checkbox", { name: "Select combo-a" }).checked).toBe(true);
      expect(within(container).getByText("combo-a").textContent).toBe("combo-a");
      expect(payloads()).toEqual([]);
    }
    expect(confirm.disabled).toBe(false);
    expect(button(dialog, "Cancel").disabled).toBe(false);
    await click(confirm);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(confirm.disabled).toBe(true);
    expect(button(dialog, "Cancel").disabled).toBe(true);
    expect(deletes().slice(2)).toEqual(firstSucceeds
      ? [["/api/combos/B", { method: "DELETE" }]]
      : [["/api/combos/A", { method: "DELETE" }], ["/api/combos/B", { method: "DELETE" }]]);
    await act(async () => { requests.slice(2).forEach((request) => request.resolve(json({ success: true }))); });
    expect(document.body.querySelector("dialog")).toBeNull();
    expect(within(container).queryByText("combo-a")).toBeNull();
    expect(within(container).queryByText("combo-b")).toBeNull();
    expect(within(container).getByText("No combos yet").textContent).toBe("No combos yet");
    expect(payloads().at(-1)).toEqual({ comboStrategies: {
      unrelated: { fallbackStrategy: "round-robin" },
    } });
    expect(payloads()).toHaveLength(firstSucceeds ? 2 : 1);
  });


  it.each([true, false])("prunes selection only after a successful collection response: %s", async (refreshSucceeds) => {
    const combos = [{ id: "A", name: "combo-a", models: [] }, { id: "B", name: "combo-b", models: [] }];
    let loads = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url === "/api/combos" && options?.method === "POST") return json({ success: true });
      if (url === "/api/combos") {
        loads += 1;
        if (loads === 1 || (!refreshSucceeds && loads === 3)) return json({ combos });
        return refreshSucceeds ? json({ combos: [combos[1]] }) : { ok: false, json: async () => ({ error: "Refresh failed" }) };
      }
      if (String(url).startsWith("/api/providers")) return json({ connections: [] });
      if (String(url).startsWith("/api/connection-groups")) return json({ groups: [] });
      return json({});
    }));
    await act(async () => { root.render(React.createElement(ProductionCombosPage)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await click(within(container).getByRole("checkbox", { name: "Select combo-a" }));
    await click(within(container).getByRole("checkbox", { name: "Select combo-b" }));
    await click(button(container, "Create Combo"));
    let dialog = document.body.querySelector("dialog");
    expect(within(container).getByRole("checkbox", { name: "Select combo-b" }).checked).toBe(true);
    await act(async () => { fireEvent.input(within(dialog).getByRole("textbox", { name: "Combo Name" }), { target: { value: "created" } }); });
    await click(button(dialog, "Create"));
    expect(document.body.querySelector("dialog")).toBeNull();
    if (refreshSucceeds) {
      expect(within(container).getByRole("checkbox", { name: "Select combo-b" }).checked).toBe(true);
      expect(within(container).queryByText("combo-a")).toBeNull();
      expect(button(container, "Delete (1)")).toBeTruthy();
    } else {
      expect(within(container).getByRole("alert").textContent).toContain("Refresh failed");
      expect(within(container).queryByRole("checkbox", { name: "Select combo-a" })).toBeNull();
      await click(button(container, "Retry"));
      expect(within(container).getByRole("checkbox", { name: "Select combo-a" }).checked).toBe(true);
      expect(within(container).getByRole("checkbox", { name: "Select combo-b" }).checked).toBe(true);
      expect(button(container, "Delete (2)")).toBeTruthy();
    }
  });

});
