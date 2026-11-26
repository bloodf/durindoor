// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCircularComboNames } from "../../src/shared/utils/circularCombos.js";

vi.mock("@/shared/constants/models", () => ({ getModelsByProviderId: () => [], getModelKind: () => null }));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/store/settingsStore", () => ({ requestSettings: async () => new Response("{}") }));
vi.mock("../../src/shared/ui/components/Modal.jsx", () => ({ default: ({ children }) => children }));
vi.mock("../../src/shared/components/CapacityBadges", () => ({ default: () => null }));

const combos = [
  { id: "a", name: "alpha", models: ["openai/gpt-5"] },
  { id: "b", name: "beta", models: ["alpha"] },
  { id: "c", name: "gamma", models: [{ kind: "combo-ref", comboId: "b", comboName: "beta" }] },
  { id: "d", name: "delta", models: ["openai/gpt-5"] },
  { id: "e", name: "epsilon", models: ["ALPHA"] },
];

describe("circular combo choices (upstream decolua/9router#2550)", () => {
  it("finds the edited combo and every combo that reaches it", () => {
    expect([...getCircularComboNames(combos, { id: "a", names: ["alpha", "alpha"] })].sort())
      .toEqual(["alpha", "beta", "epsilon", "gamma"]);
  });

  it("treats a new combo's typed name as the target", () => {
    const dangling = [{ id: "x", name: "uses-new", models: ["new-one"] }, combos[3]];

    expect([...getCircularComboNames(dangling, { names: ["new-one"] })]).toEqual(["uses-new"]);
  });

  it("blocks nothing without a combo context and survives an existing cycle", () => {
    const looped = [{ id: "l1", name: "l1", models: ["l2"] }, { id: "l2", name: "l2", models: ["l1"] }];

    expect(getCircularComboNames(combos, null).size).toBe(0);
    expect(getCircularComboNames(looped, { id: "a", names: ["alpha"] }).size).toBe(0);
  });
});

describe("ModelSelectModal circular combo choices (upstream decolua/9router#2550)", () => {
  let root;
  afterEach(async () => {
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("disables circular choices but keeps an already added one removable", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (url) =>
      new Response(JSON.stringify(url === "/api/combos" ? { combos } : { data: [] }))));
    const { default: ModelSelectModal } = await import("../../src/shared/components/ModelSelectModal.js");
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => root.render(React.createElement(ModelSelectModal, {
      isOpen: true,
      onClose: () => {},
      onSelect: () => {},
      activeProviders: [],
      addedModelValues: ["beta"],
      comboContext: { id: "a", names: ["alpha"] },
    })));

    const button = (name) => [...container.querySelectorAll("button")]
      .find((node) => node.textContent.replace("check", "") === name);
    expect(button("alpha").disabled).toBe(true);
    expect(button("gamma").disabled).toBe(true);
    expect(button("beta").disabled).toBe(false);
    expect(button("delta").disabled).toBe(false);
  });
});
