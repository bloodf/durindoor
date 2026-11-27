// UC persona model catalog. Exact port of OmniRoute c71f0065
// open-sse/executors/uc/catalog.ts: the 19 persona shortnames that are sent
// verbatim as the frame's `model`, with the source context, output and
// capability fields. Model routing reads only this list: an id outside it is
// refused, never mapped to another model or provider.
import { isString } from "../../../../src/shared/utils/typeChecks.js";

const spec = (id, name, contextLength, extra = {}) => Object.freeze({ id, name, contextLength, ...extra });

export const UC_CHAT_MODELS = Object.freeze([
  spec("claude-opus-45", "Claude Opus 4.5", 200_000, { maxOutputTokens: 64_000, supportsVision: true }),
  spec("claude-opus-46", "Claude Opus 4.6", 1_000_000, { maxOutputTokens: 128_000, supportsVision: true }),
  spec("claude-opus-46-v2", "Claude Opus 4.6 (v2)", 1_000_000, { maxOutputTokens: 128_000, supportsVision: true }),
  spec("claude-opus-47", "Claude Opus 4.7", 1_000_000, { maxOutputTokens: 128_000, supportsVision: true }),
  spec("claude-opus-47-v2", "Claude Opus 4.7 (v2)", 1_000_000, { maxOutputTokens: 128_000, supportsVision: true }),
  spec("claude-opus-48-uncensored", "Claude Opus 4.8 (Uncensored)", 1_000_000, { maxOutputTokens: 128_000, supportsVision: true }),
  spec("deepseek-r1", "DeepSeek R1", 163_840, { maxOutputTokens: 16_000, supportsReasoning: true }),
  spec("glm-5.1", "GLM 5.1", 202_752, { maxOutputTokens: 131_072 }),
  spec("gpt-5.5", "GPT-5.5", 1_050_000, { maxOutputTokens: 128_000, supportsVision: true }),
  spec("gemini-3-flash", "Gemini 3 Flash", 1_048_576, { maxOutputTokens: 65_536, supportsVision: true }),
  spec("gemini-31-uncensored", "Gemini 3.1 (Uncensored)", 1_048_576, { maxOutputTokens: 65_536, supportsVision: true }),
  spec("gemini-emotional", "Gemini (Emotional)", 1_048_576, { maxOutputTokens: 65_536, supportsVision: true }),
  spec("gemini-3-uncensored", "Gemini 3 (Uncensored)", 1_048_576, { maxOutputTokens: 65_536, supportsVision: true }),
  spec("grok-4", "Grok 4", 1_000_000, { supportsVision: true }),
  spec("grok-4-20", "Grok 4.20", 2_000_000, { supportsVision: true }),
  spec("grok-4-3", "Grok 4.3", 1_000_000, { supportsVision: true }),
  spec("kimi-k2-thinking", "Kimi K2 Thinking", 262_144, { maxOutputTokens: 262_144, supportsReasoning: true }),
  spec("kimi-k2.5", "Kimi K2.5", 262_144, { maxOutputTokens: 262_144, supportsVision: true }),
  spec("minimax-m2-her", "MiniMax M2 (Her)", 204_800, { maxOutputTokens: 131_072 }),
]);

/**
 * Source UC_REGISTRY_MODELS. `toolCalling` is true for every model because the
 * executor injects a prompted tool contract and parses the calls back.
 * `supportsVision` is the source capability of the underlying model; this
 * staged executor does not port the blob upload path, so it refuses media input.
 */
function registryModel(m) {
  const model = { id: m.id, name: m.name, contextLength: m.contextLength, toolCalling: true };
  if (m.maxOutputTokens) model.maxOutputTokens = m.maxOutputTokens;
  if (m.supportsReasoning) model.supportsReasoning = true;
  if (m.supportsVision) model.supportsVision = true;
  return Object.freeze(model);
}

export const UC_CHAT_REGISTRY_MODELS = Object.freeze(UC_CHAT_MODELS.map(registryModel));

export const UC_DEFAULT_CONTEXT = 128_000;

export function ucContextWindow(modelId) {
  return UC_CHAT_MODELS.find((m) => m.id === modelId)?.contextLength ?? UC_DEFAULT_CONTEXT;
}

const PREFIXES = ["uc/", "ucn/"];

/** The catalog id for a requested model (bare, `uc/` or `ucn/`), or null. */
export function resolveUcChatModel(model) {
  if (!isString(model)) return null;
  const prefix = PREFIXES.find((p) => model.startsWith(p));
  const id = prefix ? model.slice(prefix.length) : model;
  return UC_CHAT_MODELS.some((m) => m.id === id) ? id : null;
}
