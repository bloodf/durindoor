import { describe, expect, it } from "vitest";
import {
  apiKeyPolicyDraftToPayload,
  apiKeyPolicyPatchFromDraft,
  apiKeyPolicyToDraft,
  emptyApiKeyPolicyDraft,
  formatPolicyUsage,
  isEditableApiKeyPolicy,
  toggleApiKeyPolicyModel,
} from "../../src/app/(dashboard)/dashboard/endpoint/apiKeyPolicy.js";

describe("dashboard API-key policy drafts", () => {
  it("distinguishes unrestricted from an explicit selected list", () => {
    expect(apiKeyPolicyDraftToPayload(emptyApiKeyPolicyDraft())).toEqual({ allowedModels: [], maxTokens: null, maxCostUsd: null });
    const draft = apiKeyPolicyToDraft({ allowedModels: ["openai/gpt-test"], maxTokens: 100 });
    expect(draft.accessMode).toBe("selected");
    expect(apiKeyPolicyDraftToPayload(draft)).toEqual({ allowedModels: ["openai/gpt-test"], maxTokens: 100, maxCostUsd: null });
  });

  it("rejects an accidentally empty selected policy and invalid limits", () => {
    expect(() => apiKeyPolicyDraftToPayload({ ...emptyApiKeyPolicyDraft(), accessMode: "selected" })).toThrow("Select at least one");
    expect(() => apiKeyPolicyDraftToPayload({ ...emptyApiKeyPolicyDraft(), maxTokens: "1.5" })).toThrow("non-negative integer");
  });

  it("retains stale selections and formats committed usage", () => {
    const draft = toggleApiKeyPolicyModel(apiKeyPolicyToDraft({ allowedModels: ["missing/model"] }), "openai/gpt");
    expect(draft.allowedModels).toEqual(["missing/model", "openai/gpt"]);
    expect(formatPolicyUsage({ totalTokens: 25, totalCost: 1.25 }, { maxTokens: 100, maxCostUsd: 2 })).toEqual({
      tokens: "25 / 100 (75 remaining)",
      cost: "$1.2500 / $2.0000 ($0.7500 remaining)",
      remainingTokens: 75,
      remainingCostUsd: 0.75,
      tokensExceeded: false,
      costExceeded: false,
    });
  });

  it("omits untouched edit policy and flags reached limits", () => {
    const draft = apiKeyPolicyToDraft({ allowedModels: ["openai/gpt"], futureField: true });
    expect(apiKeyPolicyPatchFromDraft(draft, false)).toBeUndefined();
    expect(apiKeyPolicyPatchFromDraft(draft, true)).toEqual({
      allowedModels: ["openai/gpt"],
      maxTokens: null,
      maxCostUsd: null,
    });
    expect(formatPolicyUsage({ totalTokens: 100, totalCost: 3 }, { maxTokens: 100, maxCostUsd: 2 })).toMatchObject({
      remainingTokens: 0,
      remainingCostUsd: 0,
      tokensExceeded: true,
      costExceeded: true,
    });
  });

  it("rejects object-shaped malformed stored policies from the editor", () => {
    expect(isEditableApiKeyPolicy({ allowedModels: "openai/gpt" })).toBe(false);
    expect(isEditableApiKeyPolicy({ maxTokens: "bad" })).toBe(false);
    expect(isEditableApiKeyPolicy({ maxCostUsd: -1 })).toBe(false);
    expect(isEditableApiKeyPolicy({ allowedModels: ["openai/gpt"], futureField: true })).toBe(true);
  });
});
