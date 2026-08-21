import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const syntheticProviders = vi.hoisted(() => ({
  free: {
    shared: { id: "shared", name: "Shared", noAuth: true, serviceKinds: ["webSearch"] },
    "free-only": { id: "free-only", name: "Free Only", noAuth: true, serviceKinds: ["webSearch"] },
    "authenticated-free": { id: "authenticated-free", name: "Authenticated Free", serviceKinds: ["webSearch"] },
  },
  freeTier: {
    shared: { id: "shared", name: "Shared", noAuth: true, serviceKinds: ["webSearch"] },
    "authenticated-tier": { id: "authenticated-tier", name: "Authenticated Tier", serviceKinds: ["webSearch"] },
  },
}));

vi.mock("@/shared/constants/providers", async (importOriginal) => {
  const actual = await importOriginal();
  const free = { ...actual.FREE_PROVIDERS, ...syntheticProviders.free };
  const freeTier = { ...actual.FREE_TIER_PROVIDERS, ...syntheticProviders.freeTier };
  return {
    ...actual,
    FREE_PROVIDERS: free,
    FREE_TIER_PROVIDERS: freeTier,
    AI_PROVIDERS: { ...actual.AI_PROVIDERS, ...syntheticProviders.free, ...syntheticProviders.freeTier },
  };
});
vi.mock("@/shared/constants/models", () => ({
  getModelsByProviderId: () => [],
  getModelKind: () => null,
}));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("../../src/shared/components/Modal", () => ({ default: ({ children }) => children }));
vi.mock("../../src/shared/components/ProviderIcon", () => ({ default: () => null }));
vi.mock("../../src/shared/components/CapacityBadges", () => ({ default: () => null }));

const {
  default: ModelSelectModal,
  NO_AUTH_PROVIDER_IDS,
} = await import("../../src/shared/components/ModelSelectModal.js");
const {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  isHiddenProvider,
} = await import("@/shared/constants/providers");

describe("ModelSelectModal no-auth free-tier providers (upstream #3280)", () => {
  it("combines both no-auth maps, excludes hidden registry providers, and deduplicates", () => {
    const expected = [...new Set([
      ...Object.keys(FREE_PROVIDERS).filter((id) => FREE_PROVIDERS[id].noAuth && !isHiddenProvider(id)),
      ...Object.keys(FREE_TIER_PROVIDERS).filter((id) => FREE_TIER_PROVIDERS[id].noAuth && !isHiddenProvider(id)),
    ])];

    expect(NO_AUTH_PROVIDER_IDS).toEqual(expected);
    expect(NO_AUTH_PROVIDER_IDS).toContain("searxng");
    expect(NO_AUTH_PROVIDER_IDS).not.toContain("coqui");
    expect(NO_AUTH_PROVIDER_IDS).not.toContain("tortoise");
    expect(NO_AUTH_PROVIDER_IDS.filter((id) => id === "shared")).toHaveLength(1);
    expect(NO_AUTH_PROVIDER_IDS).not.toContain("authenticated-free");
    expect(NO_AUTH_PROVIDER_IDS).not.toContain("authenticated-tier");
  });

  it("keeps kindFilter exclusion for active providers absent from AI_PROVIDERS", () => {
    const html = renderToStaticMarkup(React.createElement(ModelSelectModal, {
      isOpen: false,
      onClose: () => {},
      onSelect: () => {},
      activeProviders: [{ provider: "non-ai-provider" }],
      kindFilter: "webSearch",
    }));

    expect(html).toContain("SearXNG");
    expect(html).not.toContain("non-ai-provider");
  });
});
