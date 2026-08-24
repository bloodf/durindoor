const { isObject, isString } = require("../shared/utils/typeChecks.cjs");
const REASONING_EFFORTS = require("../../open-sse/config/reasoningEfforts.json");
const REASONING_EFFORT_SET = new Set(REASONING_EFFORTS);

function normalizeReasoningEffort(value) {
  if (!isString(value)) return null;
  const normalized = value.trim().toLowerCase();
  return REASONING_EFFORT_SET.has(normalized) ? normalized : null;
}

function normalizeAliasEntry(value) {
  if (isString(value)) {
    const model = value.trim();
    return model ? { model } : null;
  }
  if (!value || !isObject(value) || Array.isArray(value)) return null;

  const model = isString(value.model) ? value.model.trim() : "";
  const reasoningEffort = normalizeReasoningEffort(value.reasoningEffort);
  if (!model && !reasoningEffort) return null;

  return {
    ...(model ? { model } : null),
    ...(reasoningEffort ? { reasoningEffort } : null)
  };
}

function normalizeAliasMappings(mappings) {
  if (!mappings || !isObject(mappings) || Array.isArray(mappings)) return {};
  const normalized = {};
  for (const [alias, value] of Object.entries(mappings)) {
    if (!alias) continue;
    const entry = normalizeAliasEntry(value);
    if (entry) normalized[alias] = entry;
  }
  return normalized;
}

function hasInvalidReasoningEffort(mappings) {
  if (!mappings || !isObject(mappings) || Array.isArray(mappings)) return false;
  return Object.values(mappings).some((value) =>
  value && isObject(
    value) &&
  !Array.isArray(value) &&
  value.reasoningEffort != null &&
  value.reasoningEffort !== "" &&
  !normalizeReasoningEffort(value.reasoningEffort)
  );
}

module.exports = {
  REASONING_EFFORTS,
  normalizeReasoningEffort,
  normalizeAliasEntry,
  normalizeAliasMappings,
  hasInvalidReasoningEffort
};