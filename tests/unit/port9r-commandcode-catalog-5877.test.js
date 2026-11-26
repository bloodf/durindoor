// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import commandcode from "../../open-sse/providers/registry/commandcode.js";

vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/hooks/useOrcaRouterCatalog", () => ({ useOrcaRouterCatalog: () => ({ models: [] }) }));
vi.mock("../../src/shared/ui/components/Modal.jsx", () => ({ default: ({ children }) => children }));
vi.mock("../../src/shared/ui/components/ProviderLogo.jsx", () => ({ ProviderLogo: () => null }));
vi.mock("../../src/shared/components/CapacityBadges", () => ({ default: () => null }));

const { default: ModelSelectModal } = await import("../../src/shared/components/ModelSelectModal.js");

describe("9router #5877 Command Code model catalog", () => {
  let root;
  let container;
  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  it("includes the V4.1 models in the offline fallback", () => {
    const ids = commandcode.models.map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      "deepseek/deepseek-v4.1-flash",
      "deepseek/deepseek-v4.1-flash-fast",
      "deepseek/deepseek-v4.1-flash-ultrafast",
    ]));
  });

  it.each([true, false])("uses the live catalog when available: %s", async (available) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const data = {
        "/api/settings": {},
        "/api/combos": { combos: [] },
        "/api/provider-nodes": { nodes: [] },
        "/api/models/custom": { models: [] },
        "/api/models/disabled": { disabled: {} },
        "/api/models/auto-sync": { providers: {} },
        "/api/providers/connection-1/models": { models: available ? [{ id: "live-only", name: "Live choice" }] : [] },
      };
      return { ok: true, json: async () => data[url] || {} };
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(ModelSelectModal, {
        isOpen: true, onClose: () => {}, onSelect: () => {},
        activeProviders: [{ id: "connection-1", provider: "commandcode", isActive: true }],
      }));
    });
    expect(container.textContent.includes("Live choice")).toBe(available);
    expect(container.textContent.includes("DeepSeek V4.1 Flash Ultrafast")).toBe(!available);
  });
});
