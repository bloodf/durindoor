import { ROLE } from "../schema/roles.js";
import { CLAUDE_BLOCK } from "../schema/blocks.js";
import { CLAUDE_STOP, OPENAI_FINISH } from "../schema/finishReasons.js";
import { MODEL_FALLBACK } from "../schema/defaults.js";

/**
 * Convert non-streaming OpenAI Chat Completions response to Anthropic Messages format.
 * Used when client speaks Claude format but upstream provider speaks OpenAI format.
 *
 * Input:  OpenAI Chat Completions JSON  {object:"chat.completion", choices:[{message:{...}}]}
 * Output: Anthropic Messages JSON        {id:"msg_...", type:"message", content:[...]}
 */
export function translateOpenAIToClaudeIfNeeded(responseBody, sourceFormat, options = {}) {
  if (!responseBody || !responseBody.choices?.[0]) return responseBody;

  const choice = responseBody.choices[0];
  const msg = choice.message || {};
  const finishReason = choice.finish_reason || OPENAI_FINISH.STOP;

  const content = [];

  // Claude emits thinking before visible text for mixed content.
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content.length > 0) {
    content.push({ type: CLAUDE_BLOCK.THINKING, thinking: msg.reasoning_content });
  }
  if (typeof msg.content === "string" && msg.content.length > 0) {
    content.push({ type: CLAUDE_BLOCK.TEXT, text: msg.content });
  }

  // Tool calls
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let input = {};
      if (typeof tc.function?.arguments === "string") {
        try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
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

  const stopReasonMap = {
    [OPENAI_FINISH.STOP]: CLAUDE_STOP.END_TURN,
    [OPENAI_FINISH.LENGTH]: CLAUDE_STOP.MAX_TOKENS,
    [OPENAI_FINISH.TOOL_CALLS]: CLAUDE_STOP.TOOL_USE,
    [OPENAI_FINISH.CONTENT_FILTER]: CLAUDE_STOP.END_TURN,
  };

  const usage = responseBody.usage || {};
  const rawId = String(responseBody.id || "").replace(/^chatcmpl-/, "");
  const claudeUsage = {};
  if (usage.prompt_tokens != null) {
    claudeUsage.input_tokens = usage.prompt_tokens;
    claudeUsage.output_tokens = (usage.completion_tokens || 0)
      + (usage.completion_tokens_details?.reasoning_tokens || 0);
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
    stop_reason: stopReasonMap[finishReason] || CLAUDE_STOP.END_TURN,
    stop_sequence: null,
    usage: claudeUsage
  };
}
