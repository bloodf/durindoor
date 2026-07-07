import { describe, expect, it } from "vitest";
import {
  buildGooglePseProviderSpecificData,
  buildGooglePseValidationPayload,
  isGooglePseReadyForSave,
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

  it("reports Google PSE ready for save only when cx is non-empty", () => {
    expect(isGooglePseReadyForSave("google-pse", "cx-1")).toBe(true);
    expect(isGooglePseReadyForSave("google-pse", "  cx-1  ")).toBe(true);
    expect(isGooglePseReadyForSave("google-pse", "")).toBe(false);
    expect(isGooglePseReadyForSave("google-pse", "   ")).toBe(false);
    expect(isGooglePseReadyForSave("google-pse", null)).toBe(false);
  });

  it("reports non-Google providers always ready for save regardless of cx", () => {
    expect(isGooglePseReadyForSave("serper", "")).toBe(true);
    expect(isGooglePseReadyForSave("openai", "  ")).toBe(true);
  });
});
