import { INLINE_THINKING_FORMATS } from "../../providers/schema.js";
import { appendReasoningText } from "../../translator/concerns/reasoning.js";
import { extractThinkTags } from "../../utils/thinkStripper.js";

import { isString } from "../../../src/shared/utils/typeChecks.js";
import { resolveInlineThinkingFormat } from "../../utils/inlineThinking.js";
export { resolveInlineThinkingFormat } from "../../utils/inlineThinking.js";

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
    if (!isString(message?.content)) return choice;

    const extracted = extractThinkTags(message.content);
    if (!extracted.matched) return choice;
    if (extracted.reasoning && message.reasoning_content != null && !isString(message.reasoning_content)) {
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
    extractedChoicePositions
  };
}