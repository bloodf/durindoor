export function emptyApiKeyPolicyDraft() {
  return { accessMode: "all", allowedModels: [], maxTokens: "", maxCostUsd: "" };
}

export function isEditableApiKeyPolicy(policy) {
  if (policy == null) return true;
  if (typeof policy !== "object" || Array.isArray(policy)) return false;
  if (Object.hasOwn(policy, "allowedModels") && (
    !Array.isArray(policy.allowedModels)
    || policy.allowedModels.some((model) => typeof model !== "string" || !model.trim())
  )) return false;
  if (Object.hasOwn(policy, "maxTokens") && policy.maxTokens != null && policy.maxTokens !== "") {
    const value = Number(policy.maxTokens);
    if (!Number.isSafeInteger(value) || value < 0) return false;
  }
  if (Object.hasOwn(policy, "maxCostUsd") && policy.maxCostUsd != null && policy.maxCostUsd !== "") {
    const value = Number(policy.maxCostUsd);
    if (!Number.isFinite(value) || value < 0) return false;
  }
  return true;
}

export function apiKeyPolicyToDraft(policy) {
  const allowedModels = Array.isArray(policy?.allowedModels) ? [...policy.allowedModels] : [];
  return {
    accessMode: allowedModels.length > 0 ? "selected" : "all",
    allowedModels,
    maxTokens: policy?.maxTokens == null ? "" : String(policy.maxTokens),
    maxCostUsd: policy?.maxCostUsd == null ? "" : String(policy.maxCostUsd),
  };
}

export function apiKeyPolicyDraftToPayload(draft) {
  const allowedModels = draft.accessMode === "all" ? [] : [...new Set(draft.allowedModels || [])];
  if (draft.accessMode === "selected" && allowedModels.length === 0) {
    throw new Error("Select at least one model or choose All models");
  }
  const maxTokens = draft.maxTokens === "" ? null : Number(draft.maxTokens);
  if (maxTokens != null && (!Number.isSafeInteger(maxTokens) || maxTokens < 0)) {
    throw new Error("Lifetime token limit must be a non-negative integer");
  }
  const maxCostUsd = draft.maxCostUsd === "" ? null : Number(draft.maxCostUsd);
  if (maxCostUsd != null && (!Number.isFinite(maxCostUsd) || maxCostUsd < 0)) {
    throw new Error("Lifetime cost limit must be a non-negative number");
  }
  return { allowedModels, maxTokens, maxCostUsd };
}

/** Omit untouched edit policy; dirty edits are sent as field patches. */
export function apiKeyPolicyPatchFromDraft(draft, dirty) {
  return dirty ? apiKeyPolicyDraftToPayload(draft) : undefined;
}

export function toggleApiKeyPolicyModel(draft, modelId) {
  const selected = new Set(draft.allowedModels || []);
  if (selected.has(modelId)) selected.delete(modelId);
  else selected.add(modelId);
  return { ...draft, allowedModels: [...selected] };
}

export function formatPolicyUsage(usage, policy) {
  const totalTokens = Number(usage?.totalTokens) || 0;
  const totalCost = Number(usage?.totalCost) || 0;
  const maxTokens = policy?.maxTokens == null ? null : Number(policy.maxTokens);
  const maxCostUsd = policy?.maxCostUsd == null ? null : Number(policy.maxCostUsd);
  const remainingTokens = maxTokens == null ? null : Math.max(0, maxTokens - totalTokens);
  const remainingCostUsd = maxCostUsd == null ? null : Math.max(0, maxCostUsd - totalCost);
  return {
    tokens: maxTokens == null
      ? `${totalTokens.toLocaleString()} used`
      : `${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()} (${remainingTokens.toLocaleString()} remaining)`,
    cost: maxCostUsd == null
      ? `$${totalCost.toFixed(4)} used`
      : `$${totalCost.toFixed(4)} / $${maxCostUsd.toFixed(4)} ($${remainingCostUsd.toFixed(4)} remaining)`,
    remainingTokens,
    remainingCostUsd,
    tokensExceeded: maxTokens != null && totalTokens >= maxTokens,
    costExceeded: maxCostUsd != null && totalCost >= maxCostUsd,
  };
}
