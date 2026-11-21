// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelSelectModal from "../../src/shared/components/ModelSelectModal.js";
import ComboFormModal from "../../src/shared/components/ComboFormModal.js";

vi.mock("../../src/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => ({}) }) }));
vi.mock("../../src/shared/hooks/useOrcaRouterCatalog", () => ({ useOrcaRouterCatalog: () => ({ models: [], degraded: false }) }));
let root, host;
const response = (value) => ({ ok: true, json: async () => value });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async (url) => response(url === "/api/combos" ? { combos: [{ id: "one", name: "test-combo" }] } : url === "/api/settings" ? {} : {})));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete document.documentElement.dataset.ui; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(element, enabled) {
  if (enabled) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
  await act(async () => root.render(element));
}
const picker = (props = {}) => React.createElement(ModelSelectModal, { isOpen: true, onClose: vi.fn(), onSelect: vi.fn(), onDeselect: vi.fn(), activeProviders: [], closeOnSelect: false, ...props });

describe.each([false, true])("picker and shared form, V5 %s", (enabled) => {
  it("selects and deselects a combo using the caller contract", async () => {
    const onSelect = vi.fn(), onDeselect = vi.fn();
    await render(picker({ onSelect, onDeselect }), enabled);
    const row = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("test-combo"));
    expect(row).toBeTruthy(); row.focus(); expect(document.activeElement).toBe(row);
    await act(async () => row.click());
    expect(onSelect).toHaveBeenCalledWith({ id: "test-combo", name: "test-combo", value: "test-combo" });
    await render(picker({ onSelect, onDeselect, addedModelValues: ["test-combo"] }), enabled);
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent.includes("test-combo")).click());
    expect(onDeselect).toHaveBeenCalledWith({ id: "test-combo", name: "test-combo", value: "test-combo" });
    expect(Boolean(document.querySelector(".v5-model-picker"))).toBe(enabled);
  });
  it("preserves model ordering, capability names and save payload", async () => {
    const onSave = vi.fn(async () => {});
    await render(React.createElement(ComboFormModal, { isOpen: true, combo: { name: "pre-example", models: ["a", "b"], capabilities: {} }, forcePrefix: "pre-", onClose: vi.fn(), onSave, activeProviders: [] }), enabled);
    const up = document.querySelector('[aria-label="Move b up"]'); expect(up).toBeTruthy();
    up.focus(); expect(document.activeElement).toBe(up); await act(async () => up.click());
    expect(document.body.textContent).toContain("Capability ceiling");
    expect([...document.querySelectorAll("label")].some((label) => label.textContent.includes("Disable vision"))).toBe(true);
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save").click());
    expect(onSave).toHaveBeenCalledWith({ name: "pre-example", models: ["b", "a"], capabilities: {} });
  });
});
it("shows loading, error and empty catalog feedback in V5", async () => {
  let finish;
  fetch.mockImplementation((url) => url === "/api/provider-nodes" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(response({})));
  await render(picker(), true);
  expect(document.body.textContent).toContain("Loading models");
  await act(async () => finish({ ok: false, status: 503 }));
  expect(document.querySelector('[role="alert"]').textContent).toContain("Provider details could not load");
  const filter = document.querySelector('[aria-label="Filter provider"]');
  await act(async () => { filter.value = "combos"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(document.body.textContent).toContain("No models found");
});
