import { deriveModelName } from "./namePatterns.js";

// Normalize version separators in a model id: hyphen between two digits becomes a dot.
// Registry ids use dots for versions ("claude-sonnet-4.5") but clients (CLIs, aliases)
// often send them with dashes ("claude-sonnet-4-5"). Only digit-digit hyphens are
// touched, so word/suffix hyphens stay intact ("-thinking", "-agentic", "qwen3-coder-next").
import { isString } from "../../../src/shared/utils/typeChecks.js";
export function normalizeModelId(modelId) {
  if (!isString(modelId)) return modelId;
  return modelId.replace(/(\d)-(\d)/g, "$1.$2");
}

// Model defaults centralized (was scattered as `m.kind || "llm"`, `quotaFamily || "normal"`, etc.)
export const MODEL_DEFAULTS = {
  kind: "llm",
  quotaFamily: "normal",
  strip: [],
  targetFormat: null
};

/**
 * Model entries may declare request-only `aliases` for saved-config migration.
 * Aliases resolve to `id` at dispatch and never become advertised catalog rows.
 */
// Normalize a registry model entry: accept terse "id" string, fill name via regex when omitted.
// Override always wins (raw spread last); name falls back to regex → id.
export function normalizeModel(raw) {
  const model = isString(raw) ? { id: raw } : raw;
  if (model.name !== undefined) return model;
  return { ...model, name: deriveModelName(model.id) };
}

// Resolve model kind with default (accepts legacy `type` field)
export function modelKind(model) {
  return model?.kind || model?.type || MODEL_DEFAULTS.kind;
}
export function modelQuotaFamily(model) {
  return model?.quotaFamily || MODEL_DEFAULTS.quotaFamily;
}
export function modelStrip(model) {
  return model?.strip || [];
}
export function modelTargetFormat(model) {
  return model?.targetFormat || MODEL_DEFAULTS.targetFormat;
}

// Per-model declared upstream formats (e.g. ["openai", "claude"]). Guards the
// sourceFormat-matched transport for multi-endpoint providers whose models
// differ in endpoint support (opencode-go: kimi/glm/mimo only do chat
// completions, minimax/qwen also do messages, deepseek also does responses).
export function modelSupportedFormats(model) {
  return model?.supportedFormats || null;
}