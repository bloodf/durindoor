import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
    { id: "music-model", name: "Music choice", type: "music" },
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
