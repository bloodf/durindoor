import { register } from "../registry.js";
import { FORMATS } from "../formats.js";
import { ROLE, CLAUDE_BLOCK, CLAUDE_STOP, MODEL_FALLBACK, OPENAI_FINISH } from "../schema/index.js";
import { claudeStopReasonWithToolCalls } from "../concerns/finishReason.js";
import { extractTextContent } from "../concerns/textContent.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { isInternalReasoningPlaceholder } from "../../utils/reasoningPlaceholder.js";
import { sanitizeErrorMessage } from "../../utils/error.js";
import { normalizeClaudeToolName } from "../../services/claudeCodeToolRemapper.js";

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { chargeRetained, retainedSize } from "../../utils/streamRetainedBudget.js";
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

// Some non-Anthropic models wrap tool arguments in a markdown ```json fence.
// Strip it so Claude clients receive parseable JSON (9router #1711).
function stripJsonFence(argsJson) {
  if (!isString(argsJson)) return argsJson;
  return argsJson.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
}

// Sanitize tool call arguments to fix bad params from non-Anthropic models
function sanitizeToolArgs(toolName, argsJson) {
  const cleaned = stripJsonFence(argsJson);
  try {
    const args = JSON.parse(cleaned);
    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX) ?
    toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length) :
    toolName;
    if (name === "Read") sanitizeReadArgs(args);
    return JSON.stringify(args);
  } catch {
    // Deduplicate doubled JSON before giving up
    const deduplicated = deduplicateDoubledJson(cleaned);
    if (deduplicated !== cleaned) {
      try {
        const args = JSON.parse(deduplicated);
        const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX) ?
        toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length) :
        toolName;
        if (name === "Read") sanitizeReadArgs(args);
        return JSON.stringify(args);
      } catch {/* fall through to raw return */}
    }
    return cleaned;
  }
}

function sanitizeReadArgs(args) {
  if (isString(args.limit) && /^\d+$/.test(args.limit)) args.limit = Number(args.limit);
  if (isString(args.offset) && /^-?\d+$/.test(args.offset)) args.offset = Number(args.offset);

  if (isNumber(args.limit)) {
    if (args.limit > 2000) args.limit = 2000;
    if (args.limit < 1) delete args.limit;
  }
  if (isNumber(args.offset) && args.offset < 0) args.offset = 0;

  if ("pages" in args && !isValidPdfPagesArg(args.file_path, args.pages)) {
    delete args.pages;
  }
}

function isValidPdfPagesArg(filePath, pages) {
  return isString(filePath) &&
  filePath.toLowerCase().endsWith(".pdf") && isString(
    pages) &&
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

// Helper: flush buffered tool args + close one tool_use block (once)
function closeToolBlock(state, key, results) {
  const toolInfo = state.toolCalls.get(key);
  if (!toolInfo || toolInfo.closed) return;
  toolInfo.closed = true;
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
  const buffered = state.toolArgBuffers?.get(key);
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

// Helper: close every still-open tool_use block
function flushToolBlocks(state, results) {
  for (const key of state.toolCalls.keys()) closeToolBlock(state, key, results);
}

// Cache completeness until more arguments arrive; block switches can revisit the
// same partial buffer many times without changing its contents.
function hasCompleteArgs(state, key) {
  const buffer = state.toolArgBuffers?.get(key);
  const cache = state.toolArgCompleteness ??= new Map();
  const previous = cache.get(key);
  if (previous && previous.buffer === buffer) return previous.complete;
  let complete = false;
  try {
    JSON.parse(buffer);
    complete = true;
  } catch { /* incomplete or invalid JSON */ }
  cache.set(key, { buffer, complete });
  return complete;
}

// Text or thinking is about to open: close the tool calls that are already whole,
// so their arguments do not land after an unrelated block (upstream #4511). A call
// with partial arguments stays open, because later fragments would be lost.
function closeCompleteToolBlocks(state, results) {
  for (const key of state.toolCalls?.keys() ?? []) {
    if (!state.toolCalls.get(key).closed && hasCompleteArgs(state, key)) closeToolBlock(state, key, results);
  }
}

// Internal keys for calls that cannot use the provider index; negative so they
// never collide with a real one.
function allocateToolKey(state) {
  state.lastSyntheticToolKey = (state.lastSyntheticToolKey ?? 0) - 1;
  return state.lastSyntheticToolKey;
}

// `index` is optional in the Chat stream and some providers reuse it, so a call is
// identified by its id (and, without one, by its name) (upstream #4511).
function resolveToolKey(state, tc, name) {
  const byIndex = Number.isInteger(tc.index);
  const keyByIndex = state.toolKeyByIndex ??= new Map();
  const key = byIndex ? keyByIndex.get(tc.index) ?? tc.index : state.lastToolKey;
  const current = state.toolCalls.get(key);
  if (tc.id) {
    const knownKey = state.toolKeyById?.get(tc.id);
    if (knownKey !== undefined) {
      if (byIndex) keyByIndex.set(tc.index, knownKey);
      return knownKey;
    }
    // No call holds this key yet: arguments that arrived first stay with it.
    if (!current) return key ?? 0;
    // A new id starts a new call once it names one or the current call is whole.
    // Some providers change the id mid-arguments; those fragments stay together.
    if (byIndex && (current.syntheticId || !name && !hasCompleteArgs(state, key))) return key;
    const fresh = allocateToolKey(state);
    if (byIndex) keyByIndex.set(tc.index, fresh);
    return fresh;
  }
  if (byIndex) return key;
  if (key === undefined) return 0;
  return name && current?.name && name !== current.name && hasCompleteArgs(state, key) ? allocateToolKey(state) : key;
}

// Convert OpenAI-shaped usage ({prompt_tokens, completion_tokens, ...}) to the
// Claude shape ({input_tokens, output_tokens, cache_*}).
function toClaudeUsage(usage) {
  const firstNumber = (...values) => values.find(isNumber) ?? 0;
  const promptTokens = firstNumber(usage.prompt_tokens, usage.input_tokens);
  const outputTokens = firstNumber(usage.completion_tokens, usage.output_tokens);

  // Extract cache tokens from prompt_tokens_details
  // A reported zero is evidence of "nothing cached", so keep it distinct from an omitted counter.
  const reportedCacheReadTokens = [
    usage.prompt_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cached_tokens,
    // DeepSeek-style and flat aliases (OmniRoute #20279); Claude-shaped counter keeps priority.
    usage.cache_read_input_tokens,
    usage.prompt_cache_hit_tokens,
    usage.cached_tokens
  ].find((value) => isNumber(value) && Number.isFinite(value) && value >= 0);
  const cacheReadTokens = reportedCacheReadTokens ?? 0;
  // Cache-write accepts the same aliases as the shared normalizer: the
  // canonical top-level field, the top-level `cache_write_tokens` alias and
  // both nested spellings. Canonical fields win over aliases and an explicitly
  // reported zero is kept as "nothing was written" rather than being read as
  // an omission. A present-but-non-numeric value counts as no cache write,
  // matching how the canonical field is treated elsewhere in this path.
  const cacheWriteRaw = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ??
    usage.prompt_tokens_details?.cache_creation_tokens ?? usage.prompt_tokens_details?.cache_write_tokens ??
    usage.input_tokens_details?.cache_creation_tokens ?? usage.input_tokens_details?.cache_write_tokens;
  const cacheCreateTokens = isNumber(cacheWriteRaw) ? cacheWriteRaw : 0;

  // input_tokens = prompt_tokens - cached_tokens - cache_creation_tokens
  // Because OpenAI's prompt_tokens includes all prompt-side tokens
  const claudeUsage = {
    input_tokens: promptTokens - cacheReadTokens - cacheCreateTokens,
    output_tokens: outputTokens
  };
  if (reportedCacheReadTokens !== undefined) claudeUsage.cache_read_input_tokens = reportedCacheReadTokens;
  if (cacheCreateTokens > 0) claudeUsage.cache_creation_input_tokens = cacheCreateTokens;

  // reasoning_tokens is already included in output_tokens, so output_tokens stays
  // the total Claude expects. Keep the breakdown as an extra field (Claude clients
  // ignore it) so usage tracking does not lose reasoning counts on translated streams.
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ??
    usage.output_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens;
  if (isNumber(reasoningTokens) && reasoningTokens > 0) claudeUsage.reasoning_tokens = reasoningTokens;
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
  const usage = state.usage?.input_tokens != null ?
  state.usage :
  state.usage?.prompt_tokens != null ?
  toClaudeUsage(state.usage) :
  { input_tokens: 0, output_tokens: 0 };

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
  if (chunk.usage && isObject(chunk.usage)) {
    const usage = toClaudeUsage(chunk.usage);
    state.usage = state.claudeFinishHandled ? { ...state.usage, ...usage } : usage;
  }
  if (!chunk.choices?.[0]) return null;

  const results = [];
  const choice = chunk.choices[0];
  const delta = choice.delta;

  // First chunk - ALWAYS send message_start first
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = chunk.id?.replace("chatcmpl-", "") || `msg_${Date.now()}`;
    if (!state.messageId || state.messageId === "chat" || state.messageId.length < 8) {
      state.messageId = chunk.extend_fields?.requestId ||
      chunk.extend_fields?.traceId ||
      `msg_${Date.now()}`;
    }
    // Preserve a client-requested model already seeded into state (see
    // createSSEStream in open-sse/utils/stream.js) so Claude-format clients
    // keep seeing the model they asked for, not the upstream provider's
    // chunk.model (e.g. a claude-* alias routed to glm-5.3). Only an unseeded
    // state (translator/index.js initState defaults model:null) falls back to
    // the provider chunk's model, then MODEL_FALLBACK.
    state.model = state.model || chunk.model || MODEL_FALLBACK;
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
      closeCompleteToolBlocks(state, results);
      state.thinkingBlockIndex = state.nextBlockIndex++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: CLAUDE_BLOCK.THINKING, thinking: "", signature: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent }
    });
  }

  // Handle regular content
  const textContent = extractTextContent(delta?.content);
  if (textContent) {
    stopThinkingBlock(state, results);

    if (!state.textBlockStarted) {
      closeCompleteToolBlocks(state, results);
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
      delta: { type: "text_delta", text: textContent }
    });
  }

  // Tool calls
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      // Strip the legacy proxy_ prefix from an incoming tool name (if any),
      // then normalize lowercase Anthropic built-ins (bash→Bash, read→Read, etc.).
      const incomingName = (() => {
        const n = tc.function?.name || "";
        const stripped = n.startsWith(CLAUDE_OAUTH_TOOL_PREFIX) ? n.slice(CLAUDE_OAUTH_TOOL_PREFIX.length) : n;
        return normalizeClaudeToolName(stripped, state.toolNameMap);
      })();

      const previousKey = Number.isInteger(tc.index) ? state.toolKeyByIndex?.get(tc.index) ?? tc.index : undefined;
      const idx = resolveToolKey(state, tc, incomingName);
      state.lastToolKey = idx;
      // The provider moved this index to another call: finish the one it held.
      if (previousKey !== undefined && previousKey !== idx) closeToolBlock(state, previousKey, results);

      // A tool call is identified by its id. Some OpenAI-compatible upstreams
      // (GLM 5.2) stream the id and function.name in SEPARATE SSE chunks. The
      // Claude protocol cannot patch a content_block_start after it is emitted,
      // so we register the tool call on the id chunk but DEFER content_block_start
      // until the name arrives (OmniRoute#6730 / decolua/9router#2077).
      // GLM/fireworks repeats id+null-name on every arg chunk; register once per idx.
      // A named call without an id gets a generated one instead of being dropped.
      if ((tc.id || incomingName) && !state.toolCalls.has(idx)) {
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);

        const toolId = tc.id || fallbackToolCallId(idx);
        chargeRetained(state, retainedSize(toolId) + retainedSize(incomingName));
        state.toolCalls.set(idx, {
          id: toolId,
          syntheticId: !tc.id,
          name: incomingName,
          blockIndex: state.nextBlockIndex++,
          startEmitted: false
        });
      }

      const toolInfo = state.toolCalls.get(idx);
      if (toolInfo) {
        (state.toolKeyById ??= new Map()).set(toolInfo.id, idx);
        // Capture a late-arriving id or name (streamed after the initial chunk).
        // A name may arrive after arguments have been buffered; record it before
        // deciding whether to emit the deferred content_block_start.
        if (tc.id && !toolInfo.id) {
          chargeRetained(state, retainedSize(tc.id));
          toolInfo.id = tc.id;
        }
        if (incomingName && !toolInfo.name) {
          chargeRetained(state, retainedSize(incomingName));
          toolInfo.name = incomingName;
        }

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
        // Buffer args instead of streaming — sanitize at finish to fix bad params.
        // Fragments may arrive before the id or name that opens the call.
        if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
        chargeRetained(state, tc.function.arguments.length);
        state.toolArgBuffers.set(idx, (state.toolArgBuffers.get(idx) || "") + tc.function.arguments);
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
      // Upstream text is public here: redact credentials (#1342).
      const message = state.upstreamError?.message ?
      sanitizeErrorMessage(state.upstreamError.message) :
      "Upstream aborted the response (malformed function call or empty candidate)";
      results.push({
        type: "error",
        error: { type: "api_error", message }
      });
    } else {
      // Use tracked usage (will be estimated in stream.js if not valid)
      const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
      // Some OpenAI-compatible upstreams report finish_reason "stop" together
      // with tool_calls. The Claude client stops its agent loop unless the turn
      // ends with stop_reason "tool_use" (#18270), so an ordinary stop that
      // carried tool calls is promoted. Truncation, safety and refusal results
      // keep their own reason (see claudeStopReasonWithToolCalls).
      const stopReason = claudeStopReasonWithToolCalls(
        choice.finish_reason,
        state.toolCalls instanceof Map && state.toolCalls.size > 0
      );
      if (stopReason === CLAUDE_STOP.TOOL_USE) {
        // The turn really ended with tool calls: keep the shared marker honest
        // for the usage injection in stream.js.
        state.finishReason = OPENAI_FINISH.TOOL_CALLS;
      }
      results.push({
        type: "message_delta",
        delta: { stop_reason: stopReason },
        usage: finalUsage
      });
      results.push({ type: "message_stop" });
    }
  }

  return results.length > 0 ? results : null;
}

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse);
