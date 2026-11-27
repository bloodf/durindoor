import { isString } from "../../src/shared/utils/typeChecks.js";
import trustedrouter from "./registry/trustedrouter.js";

/** Discovery is authoritative locally, so retain the curated embedding catalog. */
export function parseTrustedRouterModels(data) {
  const chat = parseTrustedRouterChatModels(data);
  if (chat.length === 0) return [];
  return [...chat, ...trustedrouter.embeddingConfig.models.map((model) => ({ ...model, kind: "embedding" }))];
}

/** Parse the public mixed catalog; only explicitly visible chat rows are routable here. */
export function parseTrustedRouterChatModels(data) {
  if (!Array.isArray(data?.data)) return [];
  return data.data.filter((row) => {
    const meta = row?.trustedrouter;
    return isString(row?.id) && row.id.trim() &&
      meta?.supports_chat === true && meta.configuration_hidden !== true &&
      meta.internal_only !== true && meta.synthetic_monitor !== true;
  }).map((row) => {
    const positive = (value) => Number.isFinite(value) && value > 0;
    const context = positive(row.context_length) ? row.context_length : row.top_provider?.context_length;
    const output = row.top_provider?.max_completion_tokens;
    const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
    const modalities = row.architecture?.input_modalities;
    const result = { id: row.id, name: isString(row.name) && row.name ? row.name : row.id };
    if (positive(context)) result.contextLength = context;
    if (positive(output)) result.outputTokenLimit = output;
    if (Array.isArray(modalities) && modalities.includes("image")) result.supportsVision = true;
    if (params.includes("tools")) result.supportsTools = true;
    if (params.includes("reasoning")) result.supportsThinking = true;
    return result;
  });
}
