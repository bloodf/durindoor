// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";
import { updateComboStrategy } from "@/shared/utils/comboStrategy";
import { mergeSettingsPatch } from "@/lib/db/repos/settingsRepo.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/components", () => ({
  ModelSelectModal: () => null,
  CapacityBadges: () => null,
  CardSkeleton: () => null,
}));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/components/DocsLink", () => ({ default: () => null }));
vi.mock("../../src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.jsx", () => ({ default: () => null }));

import useSettingsStore from "@/store/settingsStore";
import CombosPage from "../../src/app/(dashboard)/dashboard/combos/page.js";

// What the settings repository stores after the dashboard sends `next`.
const persisted = (stored, next) =>
  mergeSettingsPatch({ comboStrategies: stored }, { comboStrategies: next }).comboStrategies;

describe("decolua/9router#4576 - explicit combo fallback survives a different global strategy", () => {
  const stored = {
    demo: { fallbackStrategy: "round-robin", judgeModel: "cx/gpt-6-sol" },
    other: { fallbackStrategy: "fusion" },
  };

  it("persists an explicit fallback, with or without an earlier entry", () => {
    const next = updateComboStrategy(stored, "demo", { fallbackStrategy: "fallback" });
    expect(persisted(stored, next).demo).toEqual({ fallbackStrategy: "fallback", judgeModel: "cx/gpt-6-sol" });
    expect(persisted({}, updateComboStrategy({}, "demo", { fallbackStrategy: "fallback" })))
      .toEqual({ demo: { fallbackStrategy: "fallback" } });
    expect(stored.demo.fallbackStrategy).toBe("round-robin");
  });

  it("removes the stored override on inherit but keeps the other row settings", () => {
    const next = updateComboStrategy(stored, "demo", { fallbackStrategy: "inherit" });
    expect(persisted(stored, next)).toEqual({ demo: { judgeModel: "cx/gpt-6-sol" }, other: stored.other });
  });

  it("removes the whole stored entry once nothing is left in it", () => {
    const next = updateComboStrategy(stored, "other", { fallbackStrategy: "inherit" });
    expect(persisted(stored, next)).toEqual({ demo: stored.demo });
    const cleared = updateComboStrategy({ demo: { timeoutMs: 5000 } }, "demo", { timeoutMs: 0 });
    expect(persisted({ demo: { timeoutMs: 5000 } }, cleared)).toEqual({});
  });

  it("keeps per-combo context requirements when only the strategy is inherited", () => {
    const before = { demo: { fallbackStrategy: "smart", contextRequirements: { minContextWindow: 1000 } } };
    const next = updateComboStrategy(before, "demo", { fallbackStrategy: "inherit" });
    expect(persisted(before, next)).toEqual({ demo: { contextRequirements: { minContextWindow: 1000 } } });
  });
});

describe("decolua/9router#4576 - combos page strategy selector", () => {
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  let container;
  let root;
  let server;
  let patches;

  const click = async (element) => { await act(async () => element.click()); };
  const choose = async (name) => {
    await click(container.querySelector('[aria-label="Strategy for primary"]'));
    await click(within(document.body).getByRole("option", { name }));
  };

  beforeEach(async () => {
    useSettingsStore.setState({ settings: null, lastFetched: 0, error: null, loading: false });
    server = { comboStrategy: "round-robin", comboStrategies: {} };
    patches = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url === "/api/settings") {
        if (options?.method === "PATCH") {
          const patch = JSON.parse(options.body);
          patches.push(patch);
          server = { ...server, ...mergeSettingsPatch(server, patch) };
        }
        return json(structuredClone(server));
      }
      if (url === "/api/combos") return json({ combos: [{ id: "A", name: "primary", models: [] }] });
      if (String(url).startsWith("/api/providers")) return json({ connections: [] });
      if (String(url).startsWith("/api/connection-groups")) return json({ groups: [] });
      return json({});
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(CombosPage)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows the inherited global strategy, saves explicit fallback, then returns to inherit", async () => {
    const trigger = () => container.querySelector('[aria-label="Strategy for primary"]');
    expect(trigger().textContent).toContain("Inherit global");
    expect(trigger().textContent).toContain("Round Robin");

    await choose(/^Fallback/);
    expect(server.comboStrategies).toEqual({ primary: { fallbackStrategy: "fallback" } });
    expect(trigger().textContent).toContain("Fallback");
    expect(trigger().textContent).not.toContain("Inherit");

    await choose(/^Inherit global/);
    expect(server.comboStrategies).toEqual({});
    expect(patches.at(-1)).toEqual({ comboStrategies: { primary: null } });
    expect(trigger().textContent).toContain("Inherit global");
  });
});
