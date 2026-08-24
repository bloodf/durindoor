import { FORMATS } from "../formats.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { CLAUDE_BLOCK, CLAUDE_STOP, GEMINI_FINISH, MODEL_FALLBACK, OPENAI_FINISH, RESPONSES_ITEM, ROLE } from "../schema/index.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

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
  for (const toolCall of getToolCalls(completion)) {
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
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE) || CLAUDE_STOP.END_TURN,
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: (usage.completion_tokens || usage.output_tokens || 0) + (usage.completion_tokens_details?.reasoning_tokens || 0)
    }
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
      usageMetadata: {
        promptTokenCount: usage.prompt_tokens || usage.input_tokens || 0,
        candidatesTokenCount: usage.completion_tokens || usage.output_tokens || 0,
        totalTokenCount: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
      },
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

export function responsesApiToOpenAICompletion(responseBody, fallbackModel) {
  const output = Array.isArray(responseBody?.output) ? responseBody.output : [];
  const reasoningText = output.
  filter((item) => item?.type === "reasoning").
  flatMap((item) => Array.isArray(item.summary) ? item.summary : []).
  map((part) => part?.text || "").
  join("");
  const messages = output.filter((item) => item?.type === "message");
  const msgItem = [...messages].reverse().find((item) => {
    const content = Array.isArray(item.content) ? item.content : [];
    return content.some((part) => isString(part.text) && part.text.length > 0);
  }) || messages[messages.length - 1] || null;
  const textContent = (Array.isArray(msgItem?.content) ? msgItem.content : []).
  map((part) => part.type === "output_text" || isString(part.text) ? part.text || "" : "").
  join("");
  const toolCalls = output.
  filter((item) => item?.type === "function_call").
  map((item, idx) => ({
    id: item.call_id || `call_${item.name || "tool"}_${idx}`,
    type: "function",
    function: {
      name: item.name || "",
      arguments: isString(item.arguments) ? item.arguments : JSON.stringify(item.arguments || {})
    }
  }));

  const usage = responseBody?.usage || {};
  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  const cachedTokens = usage.cache_read_input_tokens || usage.cached_tokens || 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
  const promptTokens = inputTokens + cachedTokens + cacheCreationTokens;
  const promptTokenDetails = cachedTokens || cacheCreationTokens ?
  {
    ...(cachedTokens ? { cached_tokens: cachedTokens } : null),
    ...(cacheCreationTokens ? { cache_creation_tokens: cacheCreationTokens } : null)
  } :
  undefined;
  const message = {
    role: "assistant",
    content: textContent || (toolCalls.length > 0 ? null : "")
  };
  if (reasoningText) message.reasoning_content = reasoningText;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const responseDone = responseBody?.status === "completed" || responseBody?.status === "done";
  const finishReason = toolCalls.length > 0 ? "tool_calls" : responseDone ? "stop" : responseBody?.status || "stop";
  return {
    id: responseBody?.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: responseBody?.created_at || Math.floor(Date.now() / 1000),
    model: responseBody?.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: promptTokens,
      ...(promptTokenDetails ? { prompt_tokens_details: promptTokenDetails } : null),
      completion_tokens: outputTokens,
      total_tokens: usage.total_tokens || promptTokens + outputTokens
    }
  };
}

/**
 * Restore declared Responses custom-tool calls after OpenAI completion lowering.
 * Consumers normalize request metadata to a Set before this projection (#3373).
 */
function openAICompletionToResponsesOutput(completion, { customToolNames = new Set() } = {}) {
  const customToolNameSet = customToolNames instanceof Set ?
  customToolNames :
  new Set(customToolNames || []);
  if (!completion?.choices?.[0]) return completion;
  const message = getMessage(completion);
  const usage = completion.usage || {};
  const output = [];
  let idx = 0;

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) {
    output.push({
      type: "reasoning",
      id: `rs_${completion.id || Date.now()}_${idx}`,
      summary: [{ type: "summary_text", text: reasoning }]
    });
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
      const name = fn.name || toolCall.name || "";
      const callId = toolCall.id || `call_${name || "tool"}_${idx}`;
      const argumentsText = isString(fn.arguments) ? fn.arguments : JSON.stringify(fn.arguments || {});
      const custom = customToolNameSet.has(name);
      let input = argumentsText;
      if (custom) {
        try {
          const parsed = JSON.parse(argumentsText);
          if (isString(parsed?.input)) input = parsed.input;
        } catch {/* custom input is already raw */}
      }
      output.push(custom ? {
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
      });
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

  const finishReason = getChoice(completion).finish_reason || "stop";
  return {
    id: completion.id ? `resp_${completion.id}` : `resp_${Date.now()}`,
    object: "response",
    created_at: completion.created || Math.floor(Date.now() / 1000),
    model: completion.model || "unknown",
    status: finishReason === "stop" || finishReason === "tool_calls" ? "completed" : finishReason,
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