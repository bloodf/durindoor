import { describe, expect, it } from "vitest";
import {
  buildGooglePseProviderSpecificData,
  buildGooglePseValidationPayload,
  normalizeGooglePseCx,
} from "../../src/shared/utils/googlePseProviderSpecificData.js";
import { normalizeProviderSpecificData } from "../../src/lib/providerNormalization.js";

describe("Google PSE provider-specific dashboard data", () => {
  it("builds create providerSpecificData with trimmed cx", () => {
    expect(buildGooglePseProviderSpecificData("  search-engine-1  ")).toEqual({
      cx: "search-engine-1",
    });
  });

  it("omits create providerSpecificData when cx is missing", () => {
    expect(buildGooglePseProviderSpecificData("   ")).toBeUndefined();
    expect(normalizeGooglePseCx(null)).toBe("");
  });

  it("drops blank normalized cx before server-side create validation", () => {
    expect(normalizeProviderSpecificData("google-pse", {}, { cx: "   " })).toBeNull();
    expect(normalizeProviderSpecificData("google-pse", { searchEngineId: " cx-body " }, { cx: "   " })).toEqual({
      cx: "cx-body",
    });
  });

  it("includes cx in validate payloads for Google PSE", () => {
    expect(buildGooglePseValidationPayload("google-pse", "api-key", " cx-validate ")).toEqual({
      provider: "google-pse",
      apiKey: "api-key",
      providerSpecificData: { cx: "cx-validate" },
    });
  });

  it("omits providerSpecificData from Google PSE validate payloads without cx", () => {
    expect(buildGooglePseValidationPayload("google-pse", "api-key", " ")).toEqual({
      provider: "google-pse",
      apiKey: "api-key",
    });
  });

  it("preserves existing edit providerSpecificData while updating cx", () => {
    expect(buildGooglePseProviderSpecificData(" cx-edited ", {
      proxyPoolId: "pool-1",
      connectionProxyEnabled: true,
    })).toEqual({
      proxyPoolId: "pool-1",
      connectionProxyEnabled: true,
      cx: "cx-edited",
    });
  });

  it("does not add providerSpecificData to non-Google-PSE validate payloads", () => {
    expect(buildGooglePseValidationPayload("serper", "api-key", "cx-ignored")).toEqual({
      provider: "serper",
      apiKey: "api-key",
    });
  });
});
