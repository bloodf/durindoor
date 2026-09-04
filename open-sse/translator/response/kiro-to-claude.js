/**
 * Kiro → Claude Response Translator (DIRECT route, no OpenAI pivot)
 *
 * IMPORTANT: This translator does NOT receive raw Kiro AWS-EventStream frames.
 * KiroExecutor.transformEventStreamToSSE() (open-sse/executors/kiro.js) already
 * parses the binary EventStream and emits OpenAI-shaped
 * `chat.completion.chunk` objects. So the chunks arriving here are OpenAI
 * streaming chunks, and our job is OpenAI-chunk → Claude SSE events — the same
 * transformation openai-to-claude.js performs. We re-implement it here so the
 * direct `kiro:claude` route is self-contained and lossless (reasoning_content
 * → thinking blocks, tool_calls → tool_use blocks, usage → message_delta).
 *
 * Registered on the direct route by ../index.js; reached only when source
 * format is Claude and target is Kiro.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";

function stopThinkingBlock(state, results) {
  if (!state.thinkingBlockStarted) return;
  results.push({ type: "content_block_stop", index: state.thinkingBlockIndex });
  state.thinkingBlockStarted = false;
}

function stopTextBlock(state, results) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({ type: "content_block_stop", index: state.textBlockIndex });
  state.textBlockStarted = false;
}

function convertFinishReason(reason) {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    default:
      return "end_turn";
  }
}

/**
 * Convert one OpenAI-format chunk (from KiroExecutor) into Claude SSE events.
 * Returns an array of Claude events, or null when the chunk yields nothing.
 */
export function kiroToClaudeResponse(chunk, state) {
  // KiroExecutor emits chat.completion.chunk objects; tolerate string chunks
  // by attempting a parse (defensive — the direct path is always objects).
  let data = chunk;
  if (isString(chunk)) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === "[DONE]") return null;
    try {
      data = JSON.parse(trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed);
    } catch {
      return null;
    }
  }

  if (!data || !data.choices?.[0]) return null;
  // Claude message_stop is terminal. Drop every later Kiro chunk, including
  // repeated tool-call snapshots and usage attached to a duplicate finish.
  if (state.kiroClaudeFinishHandled) return null;


  const results = [];
  const choice = data.choices[0];
  const delta = choice.delta || {};

  // Track usage if present on the chunk.
  if (data.usage && isObject(data.usage)) {
    const promptTokens =
    isNumber(data.usage.prompt_tokens) ? data.usage.prompt_tokens : 0;
    const outputTokens =
    isNumber(data.usage.completion_tokens) ?
    data.usage.completion_tokens :
    0;
    state.usage = { input_tokens: promptTokens, output_tokens: outputTokens };
    // Cache tokens arrive either flat or nested under prompt_tokens_details;
    // flat wins. Dropping them made every cached Kiro turn look uncached.
    const details = data.usage.prompt_tokens_details;
    for (const field of ["cache_read_input_tokens", "cache_creation_input_tokens"]) {
      const value = isNumber(data.usage[field]) ?
      data.usage[field] :
      isNumber(details?.[field]) ? details[field] : null;
      if (value !== null) state.usage[field] = value;
    }
    // Preserve Kiro credit metering attached upstream (executor meteringEvent)
    // so onStreamComplete persists credits on the Claude route too.
    const kiroCredits = data.usage.kiro_credits !== null && data.usage.kiro_credits !== undefined ?
    Number(data.usage.kiro_credits) : NaN;
    if (Number.isFinite(kiroCredits) && kiroCredits >= 0) {
      state.usage.kiro_credits = kiroCredits;
      if (isString(data.usage.kiro_credit_unit)) {
        state.usage.kiro_credit_unit = data.usage.kiro_credit_unit;
      }
    }
    // Carry the Kiro estimate marker (emitted when fallback token counts come
    // from metering/context events without a metricsEvent) so the Claude route
    // does not persist estimated counts as authoritative.
    if (data.usage.estimated === true) {
      state.usage.estimated = true;
    }
  }

  // First chunk → emit message_start.
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId =
    isString(data.id) && data.id.replace("chatcmpl-", "") ||
    `msg_${Date.now()}`;
    state.model = data.model || "kiro";
    state.nextBlockIndex = 0;
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: "assistant",
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
  }

  // Reasoning / thinking content (Kiro reasoningContentEvent → reasoning_content).
  const reasoningContent = delta.reasoning_content || delta.reasoning;
  if (reasoningContent) {
    stopTextBlock(state, results);
    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = state.nextBlockIndex++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: "thinking", thinking: "" }
      });
    }
    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent }
    });
  }

  // Regular text content.
  if (delta.content) {
    stopThinkingBlock(state, results);
    if (!state.textBlockStarted) {
      state.textBlockIndex = state.nextBlockIndex++;
      state.textBlockStarted = true;
      state.textBlockClosed = false;
      results.push({
        type: "content_block_start",
        index: state.textBlockIndex,
        content_block: { type: "text", text: "" }
      });
    }
    results.push({
      type: "content_block_delta",
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: delta.content }
    });
  }

  // Tool calls.
  if (delta.tool_calls) {
    if (!state.toolCalls) state.toolCalls = new Map();
    if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      // Kiro echoes the sanitized name; restore what the client sent.
      const sanitizedName = tc.function?.name || "";
      const toolName = state?.toolNameMap?.get(sanitizedName) ?? sanitizedName;
      if (tc.id) {
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);
        const toolBlockIndex = state.nextBlockIndex++;
        state.toolCalls.set(idx, {
          id: tc.id,
          name: toolName,
          blockIndex: toolBlockIndex
        });
        results.push({
          type: "content_block_start",
          index: toolBlockIndex,
          content_block: {
            type: "tool_use",
            id: tc.id,
            name: toolName,
            input: {}
          }
        });
      }
        if (tc.function?.arguments) {
          const toolInfo = state.toolCalls.get(idx);
          if (toolInfo) {
            const current = state.toolArgBuffers.get(idx) || "";
            // Snapshot-aware: cumulative upstream resends (full args starting
            // with what we already have) do not double the buffer.
            const next = tc.function.arguments === current ?
            current :
            tc.function.arguments.startsWith(current) ?
            tc.function.arguments :
            current + tc.function.arguments;
            state.toolArgBuffers.set(idx, next);
          }
        }
    }
  }

  // Repeated Kiro finish chunks must not re-close tool blocks or emit events
  // after Claude's terminal message_stop. Later usage is intentionally dropped.
  if (choice.finish_reason && !state.kiroClaudeFinishHandled) {
    state.kiroClaudeFinishHandled = true;
    stopThinkingBlock(state, results);
    stopTextBlock(state, results);

    if (state.toolCalls) {
      for (const [idx, toolInfo] of state.toolCalls) {
        if (toolInfo.closed) continue;
        toolInfo.closed = true;
        const buffered = state.toolArgBuffers?.get(idx);
        if (buffered) {
          results.push({
            type: "content_block_delta",
            index: toolInfo.blockIndex,
            delta: { type: "input_json_delta", partial_json: buffered }
          });
        }
        results.push({ type: "content_block_stop", index: toolInfo.blockIndex });
      }
    }

    state.finishReason = choice.finish_reason;
    const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
    results.push({
      type: "message_delta",
      delta: { stop_reason: convertFinishReason(choice.finish_reason) },
      usage: finalUsage
    });
    results.push({ type: "message_stop" });
  }

  return results.length > 0 ? results : null;
}

/**
 * Non-streaming Kiro → Claude. KiroExecutor only produces a stream, so this is
 * a defensive helper for any non-streaming caller that hands us an aggregated
 * OpenAI-shaped completion.
 */
export function kiroToClaudeNonStreaming(data) {
  const content = [];
  const choice = data?.choices?.[0];
  const message = choice?.message || {};

  if (message.content) {
    content.push({ type: "text", text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      let input = {};
      try {
        input =
        isString(tc.function?.arguments) ?
        JSON.parse(tc.function.arguments) :
        tc.function?.arguments || {};
      } catch {
        input = {};
      }
      content.push({
        type: "tool_use",
        id: tc.id || `toolu_${Date.now()}`,
        name: tc.function?.name || "",
        input
      });
    }
  }

  const usage = data?.usage || {};
  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content,
    model: data?.model || "kiro",
    stop_reason: convertFinishReason(choice?.finish_reason || "stop"),
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0
    }
  };
}

register(FORMATS.KIRO, FORMATS.CLAUDE, null, kiroToClaudeResponse);