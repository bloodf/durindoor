import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("../../src/shared/ui/components/Modal.jsx", () => ({ default: ({ children }) => children }));
vi.mock("../../src/shared/ui/components/ProviderLogo.jsx", () => ({ ProviderLogo: () => null }));
vi.mock("../../src/shared/components/CapacityBadges", () => ({ default: () => null }));

const { filterEnabledNoAuthIds, NO_AUTH_PROVIDER_IDS } = await import("../../src/shared/components/ModelSelectModal.js");

describe("upstream #2650: model picker hides disabled no-auth providers", () => {
  it("removes ids listed in disabledFreeProviders", () => {
    const [first, ...rest] = NO_AUTH_PROVIDER_IDS;
    expect(filterEnabledNoAuthIds(NO_AUTH_PROVIDER_IDS, [first])).toEqual(rest);
  });
  it("keeps everything for missing or malformed settings", () => {
    expect(filterEnabledNoAuthIds(NO_AUTH_PROVIDER_IDS, undefined)).toEqual(NO_AUTH_PROVIDER_IDS);
    expect(filterEnabledNoAuthIds(NO_AUTH_PROVIDER_IDS, { x: true })).toEqual(NO_AUTH_PROVIDER_IDS);
  });
});
