/**
 * Validate and normalize the persisted API-key policy contract.
 *
 * Policy data is security-sensitive: malformed limits must never become NaN
 * comparisons or string allowlists that silently fail open. Unknown fields are
 * preserved for forward compatibility, while the currently enforced fields
 * are normalized to a single well-defined shape.
 */
import { isBoolean, isObject, isString } from "../../../shared/utils/typeChecks.js";
export function normalizeApiKeyPolicy(value) {
  if (value == null) return null;
  if (!isObject(value) || Array.isArray(value)) {
    throw new TypeError("API-key policy must be an object or null");
  }

  const normalized = { ...value };
  if (Object.hasOwn(value, "allowedModels")) {
    if (!Array.isArray(value.allowedModels) || value.allowedModels.some((model) => !isString(model) || !model.trim())) {
      throw new TypeError("API-key policy allowedModels must be an array of non-empty strings");
    }
    normalized.allowedModels = [...new Set(value.allowedModels.map((model) => model.trim()))];
  }

  if (Object.hasOwn(value, "allowAutoCombos")) {
    if (!isBoolean(value.allowAutoCombos)) {
      throw new TypeError("API-key policy allowAutoCombos must be a boolean");
    }
    normalized.allowAutoCombos = value.allowAutoCombos;
  }

  for (const field of ["maxTokens", "maxCostUsd"]) {
    if (!Object.hasOwn(value, field) || value[field] == null || value[field] === "") {
      if (Object.hasOwn(value, field)) normalized[field] = null;
      continue;
    }
    const number = Number(value[field]);
    if (!Number.isFinite(number) || number < 0 || field === "maxTokens" && !Number.isSafeInteger(number)) {
      throw new TypeError(`API-key policy ${field} must be a non-negative ${field === "maxTokens" ? "integer" : "number"}`);
    }
    normalized[field] = number;
  }

  if (Object.hasOwn(value, "modelAccess")) normalized.modelAccess = normalizeModelAccess(value.modelAccess);

  // Windowed limits: empty, null and 0 all mean "no limit", so they are
  // dropped rather than stored as null.
  for (const field of API_KEY_LIMIT_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    delete normalized[field];
    const raw = value[field];
    if (raw == null || raw === "" || Number(raw) === 0) continue;
    const number = Number(raw);
    const integer = field !== "monthlyBudget";
    if (!Number.isFinite(number) || number < 0 || integer && !Number.isSafeInteger(number)) {
      throw new TypeError(`API-key policy ${field} must be a non-negative ${integer ? "integer" : "number"}`);
    }
    normalized[field] = number;
  }

  return normalized;
}

/**
 * Per-key limits over a rolling minute, the local calendar day and the local
 * calendar month. Enforced by src/lib/apiKeyLimits.js. The daily total-token
 * limit is the older `dailyLimitTokens` column, so it is not repeated here.
 */
export const API_KEY_LIMIT_FIELDS = Object.freeze([
  "rpmLimit",
  "tpmLimit",
  "dailyInputTokenLimit",
  "dailyOutputTokenLimit",
  "monthlyTokenLimit",
  "monthlyInputTokenLimit",
  "monthlyOutputTokenLimit",
  "monthlyRequestLimit",
  "monthlyBudget",
]);

const MODEL_ACCESS_MODES = new Set(["all", "allow", "deny"]);
const MAX_MODEL_ACCESS_PATTERNS = 200;

/**
 * `modelAccess` is `{ mode: "all" | "allow" | "deny", patterns: string[] }`.
 * Patterns are case-insensitive globs where `*` matches anything, `/`
 * included. `null` clears the rule back to "all".
 */
function normalizeModelAccess(value) {
  if (value == null) return { mode: "all", patterns: [] };
  if (!isObject(value) || Array.isArray(value) || !MODEL_ACCESS_MODES.has(value.mode)) {
    throw new TypeError('API-key policy modelAccess.mode must be "all", "allow" or "deny"');
  }
  const raw = value.patterns ?? [];
  if (!Array.isArray(raw) || raw.some((pattern) => !isString(pattern))) {
    throw new TypeError("API-key policy modelAccess.patterns must be an array of strings");
  }
  const seen = new Set();
  const patterns = [];
  for (const item of raw) {
    const pattern = item.trim();
    if (!pattern || seen.has(pattern.toLowerCase())) continue;
    seen.add(pattern.toLowerCase());
    patterns.push(pattern);
  }
  if (patterns.length > MAX_MODEL_ACCESS_PATTERNS) {
    throw new TypeError(`API-key policy modelAccess allows at most ${MAX_MODEL_ACCESS_PATTERNS} patterns`);
  }
  return { mode: value.mode, patterns };
}

export function validateApiKeyPolicy(value) {
  try {
    return { ok: true, value: normalizeApiKeyPolicy(value), error: null };
  } catch (error) {
    return { ok: false, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Merge a management patch against the latest stored policy. */
export function mergeApiKeyPolicy(existing, patch) {
  const base = normalizeApiKeyPolicy(existing) || {};
  if (!patch || !isObject(patch) || Array.isArray(patch)) {
    throw new TypeError("API-key policy patch must be an object");
  }
  return normalizeApiKeyPolicy({ ...base, ...patch });
}