/**
 * Validate and normalize the persisted API-key policy contract.
 *
 * Policy data is security-sensitive: malformed limits must never become NaN
 * comparisons or string allowlists that silently fail open. Unknown fields are
 * preserved for forward compatibility, while the currently enforced fields
 * are normalized to a single well-defined shape.
 */
export function normalizeApiKeyPolicy(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("API-key policy must be an object or null");
  }

  const normalized = { ...value };
  if (Object.hasOwn(value, "allowedModels")) {
    if (!Array.isArray(value.allowedModels) || value.allowedModels.some((model) => typeof model !== "string" || !model.trim())) {
      throw new TypeError("API-key policy allowedModels must be an array of non-empty strings");
    }
    normalized.allowedModels = [...new Set(value.allowedModels.map((model) => model.trim()))];
  }

  for (const field of ["maxTokens", "maxCostUsd"]) {
    if (!Object.hasOwn(value, field) || value[field] == null || value[field] === "") {
      if (Object.hasOwn(value, field)) normalized[field] = null;
      continue;
    }
    const number = Number(value[field]);
    if (!Number.isFinite(number) || number < 0 || (field === "maxTokens" && !Number.isSafeInteger(number))) {
      throw new TypeError(`API-key policy ${field} must be a non-negative ${field === "maxTokens" ? "integer" : "number"}`);
    }
    normalized[field] = number;
  }

  return normalized;
}

export function validateApiKeyPolicy(value) {
  try {
    return { ok: true, value: normalizeApiKeyPolicy(value), error: null };
  } catch (error) {
    return { ok: false, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}
