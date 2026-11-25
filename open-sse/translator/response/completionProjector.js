import { FORMATS } from "../formats.js";
import {
  claudeStopReasonWithToolCalls,
  isUpstreamErrorObject,
  readUpstreamErrorMessage,
  responsesIncompleteDetailsOrOmit,
  responsesTerminalFromChatFinish
} from "../concerns/finishReason.js";
import { toClaudePromptUsage, toResponsesUsage } from "../concerns/usage.js";
import { buildGeminiUsageMetadata } from "./geminiUsageMetadata.js";
import { CLAUDE_BLOCK, CLAUDE_STOP, GEMINI_FINISH, MODEL_FALLBACK, OPENAI_FINISH, RESPONSES_ITEM, ROLE } from "../schema/index.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { isCodexMultiAgentPlaintextTool } from "../concerns/codexMultiAgent.js";

function parseArgs(value) {
  if (!value) return {};
  if (isObject(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function getChoice(completion) {
  return completion?.choices?.[0] || {};
}

function getMessage(completion) {
  return getChoice(completion).message || {};
}

function getToolCalls(completion) {
  const calls = getMessage(completion).tool_calls;
  return Array.isArray(calls) ? calls : [];
}

/**
 * Map OpenAI Chat `finish_reason` onto Gemini `finishReason` for non-stream
 * projection. Hub `finish_reason: "error"` never reaches this projector from
 * live handlers: non-stream coherence and SSE→JSON both 502 first (#1330).
 * Streaming Chat→Gemini / antigravity keep their own ERROR→OTHER maps.
 */
function openAIToGeminiFinish(reason) {
  switch (reason) {
    case OPENAI_FINISH.LENGTH:return GEMINI_FINISH.MAX_TOKENS;
    case OPENAI_FINISH.CONTENT_FILTER:return GEMINI_FINISH.SAFETY;
    default:return GEMINI_FINISH.STOP;
  }
}

function openAICompletionToClaudeMessage(completion, { claudeCompat = false, model } = {}) {
  if (!completion?.choices?.[0]) return completion;
  const choice = getChoice(completion);
  const message = getMessage(completion);
  const content = [];

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning && !claudeCompat) content.push({ type: CLAUDE_BLOCK.THINKING, thinking: reasoning });
  if (isString(message.content) && message.content.length > 0) {
    content.push({ type: CLAUDE_BLOCK.TEXT, text: message.content });
  }
  const toolCalls = getToolCalls(completion);
  for (const toolCall of toolCalls) {
    const fn = toolCall.function || {};
    content.push({
      type: CLAUDE_BLOCK.TOOL_USE,
      id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
      name: fn.name || toolCall.name || "",
      input: parseArgs(fn.arguments || toolCall.arguments)
    });
  }
  if (content.length === 0) content.push({ type: CLAUDE_BLOCK.TEXT, text: "" });

  const usage = completion.usage || {};
  const rawId = String(completion.id || `msg_${Date.now()}`);
  return {
    id: `msg_${rawId.replace(/^(?:msg_|chatcmpl-)/, "")}`,
    type: "message",
    role: ROLE.ASSISTANT,
    model: model || completion.model || MODEL_FALLBACK,
    content,
    // Same rule as the OpenAI → Claude projections: an ordinary stop that
    // carried tool calls ends the turn with "tool_use" (#18270), so an agentic
    // Claude client keeps the loop running.
    stop_reason:
      claudeStopReasonWithToolCalls(
        choice.finish_reason || OPENAI_FINISH.STOP,
        toolCalls.length > 0
      ) || CLAUDE_STOP.END_TURN,
    stop_sequence: null,
    usage: {
      ...toClaudePromptUsage(usage),
      output_tokens: (usage.completion_tokens || usage.output_tokens || 0) + (usage.completion_tokens_details?.reasoning_tokens || 0)
    }
  };
}

// A non-stream body without total_tokens still reports a total.
function geminiUsageWithTotal(usage) {
  const metadata = buildGeminiUsageMetadata(usage);
  return {
    ...metadata,
    totalTokenCount: metadata.totalTokenCount || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
  };
}

function openAICompletionToGeminiResponse(completion) {
  if (!completion?.choices?.[0]) return completion;
  const message = getMessage(completion);
  const usage = completion.usage || {};
  const parts = [];
  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) parts.push({ text: reasoning, thought: true });
  if (isString(message.content) && message.content.length > 0) {
    parts.push({ text: message.content });
  }
  for (const toolCall of getToolCalls(completion)) {
    const fn = toolCall.function || {};
    parts.push({
      functionCall: {
        name: fn.name || toolCall.name || "",
        args: parseArgs(fn.arguments || toolCall.arguments)
      }
    });
  }
  if (parts.length === 0) parts.push({ text: "" });

  return {
    response: {
      candidates: [{
        content: { role: "model", parts },
        finishReason: openAIToGeminiFinish(getChoice(completion).finish_reason),
        index: 0
      }],
      usageMetadata: geminiUsageWithTotal(usage),
      modelVersion: completion.model || "unknown",
      responseId: completion.id || `resp_${Date.now()}`
    }
  };
}

function openAICompletionToOllama(completion) {
  if (!completion?.choices?.[0]) return completion;
  const choice = getChoice(completion);
  const message = getMessage(completion);
  const ollamaMessage = {
    role: "assistant",
    content: isString(message.content) ? message.content : ""
  };
  if (message.reasoning_content) ollamaMessage.thinking = message.reasoning_content;
  const toolCalls = getToolCalls(completion).map((toolCall) => {
    const fn = toolCall.function || {};
    return {
      id: toolCall.id,
      function: {
        name: fn.name || toolCall.name || "",
        arguments: parseArgs(fn.arguments || toolCall.arguments)
      }
    };
  });
  if (toolCalls.length > 0) ollamaMessage.tool_calls = toolCalls;

  const usage = completion.usage || {};
  return {
    model: completion.model || "unknown",
    created_at: completion.created ? new Date(completion.created * 1000).toISOString() : new Date().toISOString(),
    message: ollamaMessage,
    done: true,
    done_reason: choice.finish_reason || "stop",
    prompt_eval_count: usage.prompt_tokens || usage.input_tokens || 0,
    eval_count: usage.completion_tokens || usage.output_tokens || 0
  };
}

/**
 * @param {object} responseBody - collected Responses API body
 * @param {string} [fallbackModel]
 * @param {{ chatCustomToolNames?: Set<string>, toolNameMap?: Map<string,string> }} [options] -
 *   Chat custom tools the client declared (matched after restoring aliases);
 *   their custom_tool_call items keep the Chat custom shape.
 *   Other custom calls become function calls with JSON `{input}` arguments (#1469).
 */
export function responsesApiToOpenAICompletion(responseBody, fallbackModel, { chatCustomToolNames = new Set(), toolNameMap = null } = {}) {
  // Skip null / non-object slots the same way main's optional chaining did.
  const output = (Array.isArray(responseBody?.output) ? responseBody.output : []).filter(
    (item) => item != null && isObject(item) && !Array.isArray(item)
  );
  const reasoningText = output.
  filter((item) => item?.type === "reasoning").
  flatMap((item) => Array.isArray(item.summary) ? item.summary : []).
  map((part) => part?.text || "").
  join("");
  const messages = output.filter((item) => item?.type === "message");
  const msgItem = [...messages].reverse().find((item) => {
    const content = Array.isArray(item.content) ? item.content : [];
    return content.some((part) => isString(part?.text) && part.text.length > 0);
  }) || messages[messages.length - 1] || null;
  const textContent = (Array.isArray(msgItem?.content) ? msgItem.content : []).
  map((part) => part?.type === "output_text" || isString(part?.text) ? part.text || "" : "").
  join("");
  const toolCalls = output.
  filter((item) => item?.type === "function_call" || item?.type === "custom_tool_call").
  map((item, idx) => {
    const id = item.call_id || `call_${item.name || "tool"}_${idx}`;
    if (item.type === "custom_tool_call") {
      const input = isString(item.input) ? item.input : "";
      const declared = toolNameMap?.get?.(item.name) ?? item.name;
      return chatCustomToolNames.has(declared) ?
      { id, type: "custom", custom: { name: declared, input } } :
      { id, type: "function", function: { name: item.name || "", arguments: JSON.stringify({ input }) } };
    }
    return {
      id,
      type: "function",
      function: {
        name: item.name || "",
        arguments: isString(item.arguments) ? item.arguments : JSON.stringify(item.arguments || {})
      }
    };
  });

  const usage = toResponsesUsage(responseBody?.usage) || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cachedTokens = usage.cached_tokens || 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
  const promptTokenDetails = cachedTokens || cacheCreationTokens ?
  {
    ...(cachedTokens ? { cached_tokens: cachedTokens } : null),
    ...(cacheCreationTokens ? { cache_creation_tokens: cacheCreationTokens } : null)
  } :
  undefined;
  // Reasoning is a subset of output_tokens: detail only, never added (upstream #4551).
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0;
  const message = {
    role: "assistant",
    content: textContent || (toolCalls.length > 0 ? null : "")
  };
  if (reasoningText) message.reasoning_content = reasoningText;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  // Only treat real string statuses as completed/done; primitive status (e.g. 5)
  // must not become a boolean trap — match main's `=== "completed"` check, then
  // passthrough the status value as finish_reason when not completed.
  const status = responseBody?.status;
  const responseDone = status === "completed" || status === "done";
  // Preserve known incomplete causes before considering tool calls; failed and
  // unknown terminal statuses must continue to pass through as non-successes.
  const incompleteReason = responseBody?.incomplete_details?.reason;
  const finishReason = status === "incomplete" && incompleteReason === "max_output_tokens" ? OPENAI_FINISH.LENGTH :
    status === "incomplete" && incompleteReason === "content_filter" ? OPENAI_FINISH.CONTENT_FILTER :
    status && !responseDone ? status :
    toolCalls.length > 0 ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP;
  return {
    id: responseBody?.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: responseBody?.created_at || Math.floor(Date.now() / 1000),
    model: responseBody?.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: inputTokens,
      ...(promptTokenDetails ? { prompt_tokens_details: promptTokenDetails } : null),
      completion_tokens: outputTokens,
      ...(reasoningTokens > 0 ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : null),
      total_tokens: usage.total_tokens || inputTokens + outputTokens
    }
  };
}

/**
 * Restore declared Responses custom-tool calls after OpenAI completion lowering.
 * Consumers normalize request metadata to a Set before this projection (#3373).
 * `resolveToolName` maps a provider name to the client's `{ name, namespace }` (#4200).
 */
function openAICompletionToResponsesOutput(completion, { customToolNames = new Set(), resolveToolName = (name) => ({ name }) } = {}) {
  const customToolNameSet = customToolNames instanceof Set ?
  customToolNames :
  new Set(customToolNames || []);
  if (!completion?.choices?.[0]) return completion;
  const message = getMessage(completion);
  const usage = completion.usage || {};
  const output = [];
  let idx = 0;

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning || message.reasoning_encrypted_content) {
    const item = { type: "reasoning", id: `rs_${completion.id || Date.now()}_${idx}`, summary: [{ type: "summary_text", text: reasoning || "" }] };
    if (message.reasoning_encrypted_content) item.encrypted_content = message.reasoning_encrypted_content;
    output.push(item);
    idx++;
  }

  const text = isString(message.content) ? message.content : "";
  if (text) {
    output.push({
      type: "message",
      id: `msg_${completion.id || Date.now()}_${idx}`,
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [], logprobs: [] }]
    });
    idx++;
  }

  const toolCalls = getToolCalls(completion);
  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      const fn = toolCall.function || {};
      const { name, namespace } = resolveToolName(fn.name || toolCall.name || "");
      const callId = toolCall.id || `call_${name || "tool"}_${idx}`;
      const argumentsText = isString(fn.arguments) ? fn.arguments : JSON.stringify(fn.arguments || {});
      // A namespace subtool is declared under its dotted name; a bare custom tool never claims it.
      const custom = customToolNameSet.has(namespace ? `${namespace}.${name}` : name);
      let input = argumentsText;
      if (custom) {
        try {
          const parsed = JSON.parse(argumentsText);
          if (isString(parsed?.input)) input = parsed.input;
        } catch {/* custom input is already raw */}
      }
      const item = custom ? {
        type: RESPONSES_ITEM.CUSTOM_TOOL_CALL,
        id: `ctc_${callId}`,
        call_id: callId,
        name,
        input
      } : {
        type: RESPONSES_ITEM.FUNCTION_CALL,
        id: `fc_${callId}`,
        call_id: callId,
        name,
        arguments: argumentsText
      };
      if (namespace) item.namespace = namespace;
      if (!custom && isCodexMultiAgentPlaintextTool({ name, namespace })) item.encrypted_function_args = [];
      output.push(item);
      idx++;
    }
  } else if (!text && !reasoning) {
    output.push({
      type: "message",
      id: `msg_${completion.id || Date.now()}_${idx}`,
      role: "assistant",
      content: [{ type: "output_text", text: "", annotations: [], logprobs: [] }]
    });
  }

  const rawFinish = getChoice(completion).finish_reason || OPENAI_FINISH.STOP;
  // Hub finish_reason "error" never reaches this projector from live handlers:
  // non-stream isCoherentOpenAICompletion and SSE→JSON (#1348) both 502 first.
  // Streaming Chat→Responses maps error → response.failed in sendTerminal (#1331).
  const unreachableErrorFinish = rawFinish === OPENAI_FINISH.ERROR;
  const finishReason = unreachableErrorFinish ? OPENAI_FINISH.STOP : rawFinish;
  // Real Responses statuses only for reachable finishes: incomplete / completed —
  // never the Chat literals "length" / "content_filter". Completed matches main's
  // field set (no synthetic `error: null`).
  const terminal = responsesTerminalFromChatFinish(
    finishReason,
    unreachableErrorFinish ? undefined : readUpstreamErrorMessage(completion?.error)
  );
  const incompleteDetails = responsesIncompleteDetailsOrOmit(terminal.incomplete_details);
  return {
    id: completion.id ? `resp_${completion.id}` : `resp_${Date.now()}`,
    object: "response",
    created_at: completion.created || Math.floor(Date.now() / 1000),
    model: completion.model || "unknown",
    status: terminal.status,
    ...(isUpstreamErrorObject(terminal.error) ? { error: terminal.error } : null),
    ...(incompleteDetails ? { incomplete_details: incompleteDetails } : null),
    output,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
      total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
    }
  };
}

export function projectCompletionToClientFormat(completion, sourceFormat, options = {}) {
  switch (sourceFormat) {
    case FORMATS.CLAUDE:
      return openAICompletionToClaudeMessage(completion, options);
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.ANTIGRAVITY:
    case FORMATS.VERTEX:
      return openAICompletionToGeminiResponse(completion);
    case FORMATS.OLLAMA:
      return openAICompletionToOllama(completion);
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
      return openAICompletionToResponsesOutput(completion, options);
    default:
      return completion;
  }
}
