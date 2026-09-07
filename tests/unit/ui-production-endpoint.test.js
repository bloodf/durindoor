import { describe, it, expect } from "vitest";
import {
  formatPolicyUsage,
  isEditableApiKeyPolicy,
  emptyApiKeyPolicyDraft,
  apiKeyPolicyToDraft,
} from "../../src/app/(dashboard)/dashboard/endpoint/apiKeyPolicy";
import {
  formatKeyExpiry,
  expirySelectionFromValue,
  expiryFromSelection,
} from "../../src/app/(dashboard)/dashboard/endpoint/apiKeyExpiry";
import {
  getLocalEndpointUrl,
  getCompositeEndpointEnabled,
  TUNNEL_BENEFITS,
} from "../../src/app/(dashboard)/dashboard/endpoint/endpointConstants";

const FIXED_NOW = Date.parse("2026-09-05T00:00:00Z");

describe("endpoint UI behavior contracts", () => {
  it("renders expired, future, invalid, and no-expiry key states distinctly", () => {
    const expired = formatKeyExpiry("2026-09-01T00:00:00Z", FIXED_NOW);
    const future = formatKeyExpiry("2026-12-01T00:00:00Z", FIXED_NOW);
    const invalid = formatKeyExpiry("nope", FIXED_NOW);
    const never = formatKeyExpiry(null, FIXED_NOW);

    expect(expired).toMatchObject({ danger: true });
    expect(expired.text.startsWith("Expired ")).toBe(true);
    expect(future).toMatchObject({ danger: false });
    expect(future.text.startsWith("Expires ")).toBe(true);
    expect(invalid).toEqual({ text: "Invalid expiry", danger: true });
    expect(never).toEqual({ text: "Never expires", danger: false });
  });

  it("maps absent and explicit expiry values to Select-compatible state", () => {
    expect(expirySelectionFromValue(null)).toEqual({ selection: "never", customLocalValue: "" });
    const custom = expirySelectionFromValue("2026-12-01T08:30:00.000Z");
    expect(custom.selection).toBe("custom");
    expect(custom.customLocalValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(expiryFromSelection("never", "", FIXED_NOW)).toBeNull();
    expect(() => expiryFromSelection("not-a-real-preset", "", FIXED_NOW)).toThrow("Choose a valid expiry option");
  });

  it("preserves stored policy editability and access-mode semantics", () => {
    expect(isEditableApiKeyPolicy(null)).toBe(true);
    expect(isEditableApiKeyPolicy({ allowedModels: [] })).toBe(true);
    expect(isEditableApiKeyPolicy(["bad-shape"])).toBe(false);

    const selected = apiKeyPolicyToDraft({ allowedModels: ["gpt-5"], maxTokens: 100, maxCostUsd: 5 });
    expect(selected.accessMode).toBe("selected");
    expect(selected.allowedModels).toEqual(["gpt-5"]);
    expect(apiKeyPolicyToDraft(null).accessMode).toBe("all");
  });

  it("identifies token and cost policy limits independently for key-row warning tone", () => {
    const draft = { ...emptyApiKeyPolicyDraft(), maxTokens: "100", maxCostUsd: "1" };
    const tokenExceeded = formatPolicyUsage({ totalTokens: 500, totalCost: 0.5, totalRequests: 1 }, draft);
    const costExceeded = formatPolicyUsage({ totalTokens: 10, totalCost: 5, totalRequests: 1 }, draft);

    expect(tokenExceeded.tokensExceeded).toBe(true);
    expect(tokenExceeded.costExceeded).toBe(false);
    expect(costExceeded.tokensExceeded).toBe(false);
    expect(costExceeded.costExceeded).toBe(true);
  });

  it("keeps local endpoint and tunnel enable derivation stable for endpoint rows", () => {
    expect(getLocalEndpointUrl(20128)).toBe("http://localhost:20128/v1");
    expect(getCompositeEndpointEnabled({ enabled: true })).toBe(true);
    expect(getCompositeEndpointEnabled({ enabled: false })).toBe(false);
    expect(getCompositeEndpointEnabled(null)).toBeFalsy();
  });

  it("keeps every tunnel benefit renderable by the enable modal grid", () => {
    expect(TUNNEL_BENEFITS).toHaveLength(4);
    for (const benefit of TUNNEL_BENEFITS) {
      expect(benefit).toMatchObject({
        icon: expect.any(String),
        title: expect.any(String),
        desc: expect.any(String),
      });
    }
  });
});
