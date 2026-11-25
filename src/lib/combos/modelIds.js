import { isObject, isString } from "../../shared/utils/typeChecks.js";

const nonBlank = (value) => isString(value) && value.trim() !== "";

/**
 * Reduce one untrusted combo target to the shape storage can read back: a model
 * id string, or a structured `combo-ref`. Catalog rows (`GET /api/models`)
 * collapse to `provider/model`.
 * @returns {string|object|null} null when the entry cannot be routed.
 */
export function normalizeComboModelId(entry) {
  if (isString(entry)) return nonBlank(entry) ? entry : null;
  if (!entry || !isObject(entry) || Array.isArray(entry)) return null;
  if (entry.kind === "combo-ref") return entry;
  if (nonBlank(entry.fullModel)) return entry.fullModel;
  return nonBlank(entry.provider) && nonBlank(entry.model) ? `${entry.provider}/${entry.model}` : null;
}
