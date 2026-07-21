import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK, OPENAI_FINISH } from "../schema/index.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { isInternalReasoningPlaceholder } from "../../utils/reasoningPlaceholder.js";

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";

// Detect and deduplicate doubled JSON (e.g. {"query":"x"}{"query":"x"})
// Some OpenAI-compatible models emit tool arguments as the same JSON object twice.
function deduplicateDoubledJson(str) {
  if (!str || str.length < 4) return str;
  for (let splitAt = 2; splitAt <= Math.floor(str.length / 2); splitAt++) {
    const left = str.slice(0, splitAt);
    const right = str.slice(splitAt);
    if (left === right) return left;
  }
  return str;
}

// Sanitize tool call arguments to fix bad params from non-Anthropic models
function sanitizeToolArgs(toolName, argsJson) {
  try {
    const args = JSON.parse(argsJson);
    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
      ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
      : toolName;
    if (name === "Read") sanitizeReadArgs(args);
    return JSON.stringify(args);
  } catch {
    // Deduplicate doubled JSON before giving up
    const deduplicated = deduplicateDoubledJson(argsJson);
    if (deduplicated !== argsJson) {
      try {
        const args = JSON.parse(deduplicated);
        const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
          ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
          : toolName;
        if (name === "Read") sanitizeReadArgs(args);
        return JSON.stringify(args);
      } catch { /* fall through to raw return */ }
    }
    return argsJson;
  }
}

function sanitizeReadArgs(args) {
  if (typeof args.limit === "string" && /^\d+$/.test(args.limit)) args.limit = Number(args.limit);
  if (typeof args.offset === "string" && /^-?\d+$/.test(args.offset)) args.offset = Number(args.offset);

  if (typeof args.limit === "number") {
    if (args.limit > 2000) args.limit = 2000;
    if (args.limit < 1) delete args.limit;
  }
  if (typeof args.offset === "number" && args.offset < 0) args.offset = 0;

  if ("pages" in args && !isValidPdfPagesArg(args.file_path, args.pages)) {
    delete args.pages;
  }
}

function isValidPdfPagesArg(filePath, pages) {
  return typeof filePath === "string" &&
    filePath.toLowerCase().endsWith(".pdf") &&
    typeof pages === "string" &&
    /^\d+(?:-\d+)?$/.test(pages);
}

// Helper: stop thinking block if started
function stopThinkingBlock(state, results) {
  if (!state.thinkingBlockStarted) return;
  results.push({
    type: "content_block_stop",
    index: state.thinkingBlockIndex
  });
  state.thinkingBlockStarted = false;
}

// Helper: stop text block if started
function stopTextBlock(state, results) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({
    type: "content_block_stop",
    index: state.textBlockIndex
  });
  state.textBlockStarted = false;
}

// Helper: flush buffered tool args + close every open tool_use block
function flushToolBlocks(state, results) {
  for (const [idx, toolInfo] of state.toolCalls) {
    // A tool call whose name never arrived (with only an id or buffered arguments)
    // still reserved a block index but deferred its content_block_start. Emit it now so
    // the terminal content_block_stop is not orphaned (OmniRoute#6730 edge case).
    if (!toolInfo.startEmitted) {
      toolInfo.startEmitted = true;
      results.push({
        type: "content_block_start",
        index: toolInfo.blockIndex,
        content_block: { type: CLAUDE_BLOCK.TOOL_USE, id: toolInfo.id, name: toolInfo.name || "", input: {} }
      });
    }
    // Emit buffered + sanitized args as single delta before stop
    const buffered = state.toolArgBuffers?.get(idx);
    if (buffered) {
      const sanitized = sanitizeToolArgs(toolInfo.name, buffered);
      results.push({
        type: "content_block_delta",
        index: toolInfo.blockIndex,
        delta: { type: "input_json_delta", partial_json: sanitized }
      });
    }
    results.push({
      type: "content_block_stop",
      index: toolInfo.blockIndex
    });
  }
}

// Convert OpenAI-shaped usage ({prompt_tokens, completion_tokens, ...}) to the
// Claude shape ({input_tokens, output_tokens, cache_*}).
function toClaudeUsage(usage) {
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;

  // Extract cache tokens from prompt_tokens_details
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens;
  const cacheCreationTokens = usage.prompt_tokens_details?.cache_creation_tokens;
  const cacheReadTokens = typeof cachedTokens === "number" ? cachedTokens : 0;
  const cacheCreateTokens = typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0;

  // input_tokens = prompt_tokens - cached_tokens - cache_creation_tokens
  // Because OpenAI's prompt_tokens includes all prompt-side tokens
  const claudeUsage = {
    input_tokens: promptTokens - cacheReadTokens - cacheCreateTokens,
    output_tokens: outputTokens
  };
  if (cacheReadTokens > 0) claudeUsage.cache_read_input_tokens = cacheReadTokens;
  if (cacheCreateTokens > 0) claudeUsage.cache_creation_input_tokens = cacheCreateTokens;

  // Note: completion_tokens_details.reasoning_tokens is already included in output_tokens
  // No need to add separately as Claude expects total output_tokens
  return claudeUsage;
}

// Flush-time finalization: the upstream stream ended without a finish_reason
// (truncated connection, or a gemini-family stream that closed after content).
// Close open blocks and emit message_delta + message_stop so the Claude client
// never hangs on a dangling message.
function finalizeOnFlush(state) {
  if (!state.messageStartSent || state.claudeFinishHandled) return null;
  state.claudeFinishHandled = true;

  const results = [];
  stopThinkingBlock(state, results);
  stopTextBlock(state, results);
  flushToolBlocks(state, results);

  // state.usage may still be OpenAI-shaped here: the gemini stage writes
  // prompt/completion counts into the shared pivot state, and only a real
  // finish chunk converts them — which a truncated stream never delivers.
  const usage = state.usage?.input_tokens != null
    ? state.usage
    : state.usage?.prompt_tokens != null
      ? toClaudeUsage(state.usage)
      : { input_tokens: 0, output_tokens: 0 };

  const stopReason = state.toolCalls.size > 0 ? "tool_use" : "end_turn";
  results.push({
    type: "message_delta",
    delta: { stop_reason: stopReason },
    usage
  });
  results.push({ type: "message_stop" });
  return results;
}

// Convert OpenAI stream chunk to Claude format
export function openaiToClaudeResponse(chunk, state) {
  if (!chunk) return finalizeOnFlush(state);
  if (!chunk.choices?.[0]) return null;

  const results = [];
  const choice = chunk.choices[0];
  const delta = choice.delta;

  // Track usage from OpenAI chunk if available
  if (chunk.usage && typeof chunk.usage === "object") {
    state.usage = toClaudeUsage(chunk.usage);
  }

  // First chunk - ALWAYS send message_start first
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = chunk.id?.replace("chatcmpl-", "") || `msg_${Date.now()}`;
    if (!state.messageId || state.messageId === "chat" || state.messageId.length < 8) {
      state.messageId = chunk.extend_fields?.requestId ||
        chunk.extend_fields?.traceId ||
        `msg_${Date.now()}`;
    }
    state.model = chunk.model || MODEL_FALLBACK;
    state.nextBlockIndex = 0;
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: ROLE.ASSISTANT,
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
  }

  // Handle reasoning (thinking) across vendor shapes - GLM/DeepSeek/Qwen/MiniMax/etc.
  const reasoningContent = extractReasoningText(delta);
  if (reasoningContent && !state.claudeCompat && !isInternalReasoningPlaceholder(reasoningContent)) {
    stopTextBlock(state, results);

    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = state.nextBlockIndex++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: CLAUDE_BLOCK.THINKING, thinking: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent }
    });
  }

  // Handle regular content
  if (delta?.content) {
    stopThinkingBlock(state, results);

    if (!state.textBlockStarted) {
      state.textBlockIndex = state.nextBlockIndex++;
      state.textBlockStarted = true;
      state.textBlockClosed = false;
      results.push({
        type: "content_block_start",
        index: state.textBlockIndex,
        content_block: { type: CLAUDE_BLOCK.TEXT, text: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: delta.content }
    });
  }

  // Tool calls
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;

      // Strip the legacy proxy_ prefix from an incoming tool name (if any).
      const incomingName = (() => {
        const n = tc.function?.name || "";
        return n.startsWith(CLAUDE_OAUTH_TOOL_PREFIX) ? n.slice(CLAUDE_OAUTH_TOOL_PREFIX.length) : n;
      })();

      // A tool call is identified by its id. Some OpenAI-compatible upstreams
      // (GLM 5.2) stream the id and function.name in SEPARATE SSE chunks. The
      // Claude protocol cannot patch a content_block_start after it is emitted,
      // so we register the tool call on the id chunk but DEFER content_block_start
      // until the name arrives (OmniRoute#6730 / decolua/9router#2077).
      // GLM/fireworks repeats id+null-name on every arg chunk; register once per idx.
      if (tc.id && !state.toolCalls.has(idx)) {
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);

        state.toolCalls.set(idx, {
          id: tc.id,
          name: incomingName,
          blockIndex: state.nextBlockIndex++,
          startEmitted: false
        });
      }

      const toolInfo = state.toolCalls.get(idx);
      if (toolInfo) {
        // Capture a late-arriving id or name (streamed after the initial chunk).
        // A name may arrive after arguments have been buffered; record it before
        // deciding whether to emit the deferred content_block_start.
        if (tc.id && !toolInfo.id) toolInfo.id = tc.id;
        if (incomingName && !toolInfo.name) toolInfo.name = incomingName;

        // Emit content_block_start once we have a name. Arguments that arrive
        // before the name are buffered without opening the block, so the first
        // emitted content_block_start always carries the correct tool name.
        if (!toolInfo.startEmitted && toolInfo.name) {
          toolInfo.startEmitted = true;
          results.push({
            type: "content_block_start",
            index: toolInfo.blockIndex,
            content_block: {
              type: CLAUDE_BLOCK.TOOL_USE,
              id: toolInfo.id,
              name: toolInfo.name,
              input: {}
            }
          });
        }
      }

      if (tc.function?.arguments) {
        if (toolInfo) {
          // Buffer args instead of streaming — sanitize at finish to fix bad params
          if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
          state.toolArgBuffers.set(idx, (state.toolArgBuffers.get(idx) || "") + tc.function.arguments);
        }
      }
    }
  }

  // Finish — guard with a Claude-specific flag, NOT the shared state.finishReason:
  // in a pivot like Antigravity/Gemini → OpenAI → Claude the upstream stage already
  // sets state.finishReason (for stream.js usage injection); keying on it would
  // suppress this flush and drop the buffered tool-call input_json_delta. The flag
  // also dedupes repeated finish_reason chunks from OpenAI-compatible models.
  if (choice.finish_reason && !state.claudeFinishHandled) {
    state.claudeFinishHandled = true;
    stopThinkingBlock(state, results);
    stopTextBlock(state, results);
    flushToolBlocks(state, results);

    // Mark finish for later usage injection in stream.js
    state.finishReason = choice.finish_reason;

    if (choice.finish_reason === OPENAI_FINISH.ERROR) {
      // Upstream aborted the turn (e.g. Gemini MALFORMED_FUNCTION_CALL or an error
      // object embedded in a 200 stream). A clean end_turn here makes the client
      // treat a broken turn as a finished answer; a mid-stream error event is
      // retryable by Anthropic clients.
      const message = state.upstreamError?.message ||
        "Upstream aborted the response (malformed function call or empty candidate)";
      results.push({
        type: "error",
        error: { type: "api_error", message }
      });
    } else {
      // Use tracked usage (will be estimated in stream.js if not valid)
      const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
      results.push({
        type: "message_delta",
        delta: { stop_reason: convertFinishReason(choice.finish_reason) },
        usage: finalUsage
      });
      results.push({ type: "message_stop" });
    }
  }

  return results.length > 0 ? results : null;
}

const convertFinishReason = (reason) => fromOpenAIFinish(reason, "claude");

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse);
