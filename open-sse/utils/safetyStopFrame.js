/**
 * Explicit provider safety/refusal stops carried by one parsed stream payload.
 *
 * A provider-declared stop (content filter, refusal, safety block) is a
 * terminal answer for that request, not an empty or truncated stream: it must
 * not be mistaken for "no output yet" and replayed on a sibling model or
 * account. Only structured stop fields count. An empty stream, a transport
 * failure and an error envelope are separate cases and never match here.
 * The non-stream equivalent lives in the combo empty-body check.
 */
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { CLAUDE_STOP, GEMINI_CONTENT_FILTER_FINISH_REASONS, OPENAI_FINISH } from "../translator/schema/finishReasons.js";

function nonEmptyString(value) {
  return isString(value) && value.trim().length > 0;
}

function isOpenAIStop(parsed) {
  return Array.isArray(parsed.choices) && parsed.choices.some((choice) =>
    choice?.finish_reason === OPENAI_FINISH.CONTENT_FILTER ||
    nonEmptyString(choice?.delta?.refusal) ||
    nonEmptyString(choice?.message?.refusal));
}

function isGeminiStop(parsed) {
  const response = isRecord(parsed.response) ? parsed.response : parsed;
  return Array.isArray(response.candidates) && response.candidates.some((candidate) =>
    GEMINI_CONTENT_FILTER_FINISH_REASONS.has(String(candidate?.finishReason || "").toUpperCase())) ||
    nonEmptyString(response.promptFeedback?.blockReason);
}

function isResponsesStop(parsed) {
  if (parsed.type === "response.refusal.delta" || parsed.type === "response.refusal.done") {
    return nonEmptyString(parsed.delta) || nonEmptyString(parsed.refusal);
  }
  if (parsed.type === "response.incomplete") {
    return parsed.response?.incomplete_details?.reason === OPENAI_FINISH.CONTENT_FILTER;
  }
  return false;
}

/** True when the parsed SSE payload is a structured provider safety/refusal stop. */
export function isSafetyStopPayload(parsed) {
  if (!isRecord(parsed)) return false;
  if (parsed.type === "message_delta") return parsed.delta?.stop_reason === CLAUDE_STOP.REFUSAL;
  return isOpenAIStop(parsed) || isResponsesStop(parsed) || isGeminiStop(parsed);
}
