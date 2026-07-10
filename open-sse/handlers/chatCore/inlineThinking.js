import { PROVIDERS } from "../../config/providers.js";
import { INLINE_THINKING_FORMATS } from "../../providers/schema.js";
import { appendReasoningText } from "../../translator/concerns/reasoning.js";
import { extractThinkTags } from "../../utils/thinkStripper.js";

/**
 * Resolve an inline-thinking response quirk from the exact selected transport
 * and model id. A similarly named model on another provider is intentionally
 * not eligible.
 */
export function resolveInlineThinkingFormat(provider, model, targetFormat) {
  const config = PROVIDERS[provider];
  if (!config || typeof model !== "string" || typeof targetFormat !== "string") return null;

  const transport = Array.isArray(config.transports)
    ? config.transports.find(candidate => candidate?.format === targetFormat)
    : null;
  const selected = transport || (config.format === targetFormat ? config : null);
  const policy = selected?.quirks?.inlineThinking;
  if (!policy || !Array.isArray(policy.models) || !policy.models.includes(model)) return null;
  return policy.format || null;
}

/**
 * Normalize a raw OpenAI completion before any lossy client projection.
 * Each choice is copied independently; indexes, finish reasons, tools, usage,
 * structured reasoning fields, and unrelated message properties are retained.
 */
export function normalizeInlineThinkingResponse(responseBody, { provider, model, targetFormat }) {
  const format = resolveInlineThinkingFormat(provider, model, targetFormat);
  const configured = format === INLINE_THINKING_FORMATS.THINK_TAGS;
  if (!configured || !Array.isArray(responseBody?.choices)) {
    return { responseBody, configured, extractedChoicePositions: new Set() };
  }

  const extractedChoicePositions = new Set();
  let changed = false;
  const choices = responseBody.choices.map((choice, position) => {
    const message = choice?.message;
    if (typeof message?.content !== "string") return choice;

    const extracted = extractThinkTags(message.content);
    if (!extracted.matched) return choice;
    if (extracted.reasoning && message.reasoning_content != null && typeof message.reasoning_content !== "string") {
      return choice;
    }

    const nextMessage = { ...message, content: extracted.content };
    if (extracted.reasoning) {
      nextMessage.reasoning_content = appendReasoningText(message.reasoning_content, extracted.reasoning);
    }
    extractedChoicePositions.add(position);
    changed = true;
    return { ...choice, message: nextMessage };
  });

  return {
    responseBody: changed ? { ...responseBody, choices } : responseBody,
    configured,
    extractedChoicePositions,
  };
}
