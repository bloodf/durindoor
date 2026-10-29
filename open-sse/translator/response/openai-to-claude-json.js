import { ROLE } from "../schema/roles.js";
import { CLAUDE_BLOCK } from "../schema/blocks.js";
import { CLAUDE_STOP, OPENAI_FINISH } from "../schema/finishReasons.js";
import { MODEL_FALLBACK } from "../schema/defaults.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { FORMATS } from "../formats.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const DEFAULT_UPSTREAM_ABORT_MESSAGE =
  "Upstream aborted the response (malformed function call or empty candidate)";

/**
 * Plain-record guard. Shared `isObject` follows `typeof` and treats `null` as an
 * object, so callers that would read `.message` / nested fields must use this
 * instead of a bare `typeof === "object"` check (#1330 robustness).
 */
function isPlainRecord(value) {
  return value != null && isObject(value) && !Array.isArray(value);
}

/**
 * Prefer a non-empty string `message` from a plain upstream error object.
 * Null, strings, primitives, arrays, and missing/empty fields fall through
 * without throwing so the translator keeps main's non-throwing contract.
 */
function messageFromUpstreamError(...candidates) {
  for (const candidate of candidates) {
    if (!isPlainRecord(candidate)) continue;
    if (isString(candidate.message) && candidate.message.length > 0) return candidate.message;
  }
  return null;
}

/**
 * Convert non-streaming OpenAI Chat Completions response to Anthropic Messages format.
 * Used when client speaks Claude format but upstream provider speaks OpenAI format.
 *
 * Input:  OpenAI Chat Completions JSON  {object:"chat.completion", choices:[{message:{...}}]}
 * Output: Anthropic Messages JSON        {id:"msg_...", type:"message", content:[...]}
 *         or Anthropic error terminal    {type:"error", error:{type, message}} when
 *         `finish_reason` is the hub `"error"` abort (#1330 / #1089).
 *         Only the known string `"error"` drives that terminal; null / empty /
 *         unknown / non-string finishes keep main's end_turn message path.
 */
export function translateOpenAIToClaudeIfNeeded(responseBody, sourceFormat, options = {}) {
  if (!responseBody || !responseBody.choices?.[0]) return responseBody;

  const choice = responseBody.choices[0];
  const msg = choice.message || {};
  const rawFinish = choice.finish_reason;

  // Match the streaming Chat→Claude translator: only the hub `"error"` finish is
  // an aborted turn. Returning type:"message" with stop_reason end_turn makes
  // Anthropic clients treat a broken turn as done.
  if (rawFinish === OPENAI_FINISH.ERROR) {
    const message = messageFromUpstreamError(responseBody.error, choice.error) ||
      DEFAULT_UPSTREAM_ABORT_MESSAGE;
    return {
      type: "error",
      error: {
        type: "api_error",
        message,
      },
    };
  }

  const finishReason = rawFinish || OPENAI_FINISH.STOP;

  const content = [];

  // Claude emits thinking before visible text for mixed content. Read every
  // reasoning alias (reasoning_content, reasoning, reasoning_text, details[]) so
  // an empty-content Copilot turn with only reasoning_text still yields a thinking
  // block instead of a bare "(empty response)" that detectMalformed rejects (502).
  const reasoningText = extractReasoningText(msg);
  if (reasoningText.length > 0) {
    content.push({ type: CLAUDE_BLOCK.THINKING, thinking: reasoningText });
  }
  if (isString(msg.content) && msg.content.length > 0) {
    content.push({ type: CLAUDE_BLOCK.TEXT, text: msg.content });
  }

  // Tool calls
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let input = {};
      if (isString(tc.function?.arguments)) {
        try {input = JSON.parse(tc.function.arguments);} catch {input = {};}
      }
      content.push({
        type: CLAUDE_BLOCK.TOOL_USE,
        id: tc.id || `call_${tc.function?.name || "unknown"}_${Date.now()}`,
        name: tc.function?.name || "unknown",
        input
      });
    }
  }

  // If no content blocks at all, add empty text block (Anthropic requires at least one)
  if (content.length === 0) {
    content.push({ type: CLAUDE_BLOCK.TEXT, text: "" });
  }


  const usage = responseBody.usage || {};
  const rawId = String(responseBody.id || "").replace(/^chatcmpl-/, "");
  const claudeUsage = {};
  if (usage.prompt_tokens != null) {
    claudeUsage.input_tokens = usage.prompt_tokens;
    claudeUsage.output_tokens = (usage.completion_tokens || 0) + (
    usage.completion_tokens_details?.reasoning_tokens || 0);
    if (usage.prompt_tokens_details?.cached_tokens) {
      claudeUsage.cache_read_input_tokens = usage.prompt_tokens_details.cached_tokens;
    }
  }

  return {
    id: `msg_${rawId || Date.now()}`,
    type: "message",
    role: ROLE.ASSISTANT,
    content,
    model: options.model || responseBody.model || MODEL_FALLBACK,
    stop_reason: fromOpenAIFinish(finishReason, FORMATS.CLAUDE) || CLAUDE_STOP.END_TURN,
    stop_sequence: null,
    usage: claudeUsage
  };
}