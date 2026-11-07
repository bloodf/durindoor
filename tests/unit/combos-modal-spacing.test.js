// @vitest-environment happy-dom
/**
 * The Create/Edit Combo modal must put Cancel/Create in the Modal primitive's
 * footer slot (not inline in the body) so spacing matches KeysPageClient.
 */
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

import CombosPage from "../../src/app/(dashboard)/dashboard/combos/page.js";

const json = (body) => ({ ok: true, status: 200, json: async () => body });

describe("Create Combo modal spacing", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    globalThis.fetch = vi.fn(async (url) => {
      const path = String(url);
      if (path.startsWith("/api/combos")) return json({ combos: [] });
      if (path.startsWith("/api/providers")) return json({ connections: [] });
      if (path.startsWith("/api/connection-groups")) return json({ groups: [] });
      if (path.startsWith("/api/models/alias")) return json({ aliases: {} });
      return json({});
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

  it.each(["", "0", "-1"])("explains invalid weight %j without losing focus and saves the corrected draft", async (invalid) => {
    const combo = { id: "weighted", name: "weighted", models: ["openai/model"], members: [{ id: "openai/model", weight: 2 }] };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, options) => {
      if (url === "/api/combos") return json({ combos: [combo] });
      return originalFetch(url, options);
    });
    await act(async () => { root.render(React.createElement(CombosPage)); });
    await flush();
    await act(async () => { within(container).getByRole("button", { name: "Edit", exact: true }).click(); });
    const dialog = document.body.querySelector("dialog");
    const input = within(dialog).getByRole("spinbutton", { name: "Weight" });
    const save = within(dialog).getByRole("button", { name: "Save", exact: true });
    input.focus();
    await act(async () => { fireEvent.input(input, { target: { value: invalid } }); });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")).textContent).toBe("Use a positive weight");
    expect(save.disabled).toBe(true);
    await act(async () => { save.click(); });
    expect(globalThis.fetch.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(0);
    await act(async () => { fireEvent.input(input, { target: { value: "3" } }); });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(within(dialog).queryByText("Use a positive weight")).toBeNull();
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); });
    const writes = globalThis.fetch.mock.calls.filter(([, options]) => options?.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body)).toEqual({ name: "weighted", models: ["openai/model"], members: [{ id: "openai/model", weight: 3 }], capabilities: {} });
  });

  it("renders Cancel and Create inside the dialog footer", async () => {
    await act(async () => { root.render(React.createElement(CombosPage)); });
    await flush();
    await flush();
    // Empty state renders a second "Create Combo" button; either opens the modal.
    const [open] = await within(document.body).findAllByRole("button", { name: "Create Combo" });
    await act(async () => { open.click(); });

    const dialog = document.body.querySelector("dialog");
    expect(dialog).not.toBeNull();
    const footer = dialog.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(within(footer).getByRole("button", { name: "Create" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "Cancel" })).toBeTruthy();
    // No stray inline buttons left in the body.
    const strays = within(dialog)
      .queryAllByRole("button", { name: /^(Create|Cancel)$/ })
      .filter((b) => !footer.contains(b));
    expect(strays).toHaveLength(0);
  });
});
