// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/constants/providers", async (importOriginal) => {
  const actual = await importOriginal();
  const providers = {
    fixture: { name: "Fixture", serviceKinds: ["llm", "video", "music"] },
    passthrough: { name: "Passthrough", passthroughModels: true, serviceKinds: ["llm", "video", "music"] },
  };
  return {
    ...actual,
    OAUTH_PROVIDERS: {}, FREE_PROVIDERS: {}, FREE_TIER_PROVIDERS: {},
    APIKEY_PROVIDERS: providers, AI_PROVIDERS: providers,
    getProviderAlias: (id) => id,
  };
});
vi.mock("@/shared/constants/models", () => ({
  getModelsByProviderId: () => [
    { id: "chat-model", name: "Chat choice", kind: "llm" },
    { id: "video-model", name: "Video choice", kind: "video" },
    { id: "paid-video", name: "Paid video choice", kind: "video" },
    { id: "music-model", name: "Music choice", type: "music" },
    { id: "paid-music", name: "Paid music choice", kind: "music" },
  ],
  getModelKind: (model) => model?.kind || model?.type || null,
}));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/hooks/useOrcaRouterCatalog", () => ({ useOrcaRouterCatalog: () => ({ models: [] }) }));
vi.mock("../../src/shared/ui/components/Modal.jsx", () => ({ default: ({ children }) => children }));
vi.mock("../../src/shared/ui/components/ProviderLogo.jsx", () => ({ ProviderLogo: () => null }));
vi.mock("../../src/shared/components/CapacityBadges", () => ({ default: () => null }));

const { default: ModelSelectModal } = await import("../../src/shared/components/ModelSelectModal.js");

describe("media picker service kinds (#1136)", () => {
  it.each(["fixture", "passthrough"])("offers only the requested media kind for %s", (provider) => {
    for (const [kind, selected, excluded] of [
      ["video", "Video choice", "Music choice"],
      ["music", "Music choice", "Video choice"],
    ]) {
      const html = renderToStaticMarkup(React.createElement(ModelSelectModal, {
        isOpen: true, onClose: () => {}, onSelect: () => {},
        activeProviders: [{ provider, isActive: true }], kindFilter: kind,
      }));
      expect(html).toContain(selected);
      expect(html).not.toContain("Chat choice");
      expect(html).not.toContain(excluded);
    }
  });
});

// Mount the actual caller so effects, fetch URLs and catalog intersection run.
describe("media picker hide-paid catalog fetch (#1136)", () => {
  let root;
  let container;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  it.each(["fixture", "passthrough"])("switches endpoint catalogs and hides excluded choices for %s", async (provider) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const response = (body) => ({ ok: true, json: async () => body });
    const fetchMock = vi.fn(async (url) => {
      if (url === "/api/settings") return response({ hidePaidModels: true });
      // Mixed API-shaped rows deliberately include wrong kinds. The picker
      // must enforce its kind even when those ids survive catalog intersection.
      if (url === "/api/v1/models/video" || url === "/api/v1/models/music") {
        return response({ object: "list", data: [
          { id: `${provider}/chat-model`, object: "model", kind: "llm" },
          { id: `${provider}/video-model`, object: "model", kind: "video" },
          { id: `${provider}/music-model`, object: "model", kind: "music" },
        ] });
      }
      const ancillary = {
        "/api/combos": { combos: [] },
        "/api/provider-nodes": { nodes: [] },
        "/api/models/custom": { models: [] },
        "/api/models/disabled": { disabled: {} },
        "/api/models/auto-sync": { providers: {} },
      };
      if (Object.hasOwn(ancillary, url)) return response(ancillary[url]);
      throw new Error(`Unexpected picker fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const props = {
      isOpen: true, onClose: () => {}, onSelect: () => {},
      activeProviders: [{ provider, isActive: true }],
    };
    for (const [kind, selected, excluded] of [
      ["video", "Video choice", "Music choice"],
      ["music", "Music choice", "Video choice"],
    ]) {
      await act(async () => {
        root.render(React.createElement(ModelSelectModal, { ...props, kindFilter: kind }));
      });
      expect(fetchMock).toHaveBeenCalledWith(`/api/v1/models/${kind}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(container.textContent).toContain(selected);
      expect(container.textContent).not.toContain(excluded);
      expect(container.textContent).not.toContain("Chat choice");
      expect(container.textContent).not.toContain("Paid video choice");
      expect(container.textContent).not.toContain("Paid music choice");
    }
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/models", expect.anything());
  });
});
