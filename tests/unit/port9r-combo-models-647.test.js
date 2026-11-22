// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/shared/components", () => ({ ModelSelectModal: () => null, CapacityBadges: () => null, CardSkeleton: () => null }));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/components/DocsLink", () => ({ default: () => null }));
vi.mock("../../src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.jsx", () => ({ default: () => null }));
import CombosPage from "../../src/app/(dashboard)/dashboard/combos/page.js";

afterEach(() => { vi.restoreAllMocks(); });
it("shows and edits a combo with missing models", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  globalThis.fetch = vi.fn(async (url) => ({ ok: true, json: async () => String(url) === "/api/combos" ? { combos: [{ id: "broken", name: "broken", models: null }] } : {} }));
  try {
    await act(async () => { root.render(React.createElement(CombosPage)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(within(container).getByText("broken")).toBeTruthy();
    await act(async () => { within(container).getByRole("button", { name: "Edit", exact: true }).click(); });
    expect(document.body.querySelector("dialog")).toBeTruthy();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
