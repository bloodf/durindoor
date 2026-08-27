import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, OPENAI_FINISH } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";

// Create OpenAI chunk helper
import { isNumber, isObject } from "../../../src/shared/utils/typeChecks.js";
function createChunk(state, delta, finishReason = null) {
  return buildChunk(
    { id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model },
    delta,
    finishReason
  );
}

// Empty/thinking-only stream guard: OpenAI-compat clients (AI SDK / Kilo)
// treat a stream that reaches finish_reason without any prior delta.content
// or tool_calls as an empty completion and throw APIEmptyResponseError, even
// though the upstream stream succeeded (e.g. thinking-only responses map to
// reasoning_content, never content). Emit a single whitespace content delta
// before the terminal chunk so such streams are accepted. Streams that
// already emitted text or tool calls are unchanged. Independent
// re-implementation of the VansRouter 5cc11b8 intent (not a cherry-pick).
function pushSyntheticContentIfEmpty(state, results) {
  if (state.contentEmitted || state.toolCalls?.size > 0) return;
  results.push(createChunk(state, { content: " " }));
  state.contentEmitted = true;
}

// Convert Claude stream chunk to OpenAI format
export function claudeToOpenAIResponse(chunk, state) {
  if (!chunk) return null;

  const results = [];
  const event = chunk.type;

  switch (event) {
    case "message_start":{
        state.messageId = chunk.message?.id || `msg_${Date.now()}`;
        state.model = chunk.message?.model;
        state.toolCallIndex = 0;
        // Claude sends input_tokens + cache_read + cache_creation here; message_delta
        // later carries only the final output_tokens. Capture cache now so the
        // delta (output-only) doesn't reset it to zero.
        const startUsage = chunk.message?.usage;
        if (startUsage && isObject(startUsage)) {
          const inputTokens = isNumber(startUsage.input_tokens) ? startUsage.input_tokens : 0;
          const cacheReadTokens = isNumber(startUsage.cache_read_input_tokens) ? startUsage.cache_read_input_tokens : 0;
          const cacheCreationTokens = isNumber(startUsage.cache_creation_input_tokens) ? startUsage.cache_creation_input_tokens : 0;
          const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
          state.usage = {
            prompt_tokens: promptTokens,
            completion_tokens: 0,
            total_tokens: promptTokens,
            input_tokens: inputTokens,
            output_tokens: 0
          };
          if (cacheReadTokens > 0) state.usage.cache_read_input_tokens = cacheReadTokens;
          if (cacheCreationTokens > 0) state.usage.cache_creation_input_tokens = cacheCreationTokens;
        }
        results.push(createChunk(state, { role: ROLE.ASSISTANT }));
        break;
      }

    case "content_block_start":{
        const block = chunk.content_block;
        if (block?.type === "server_tool_use") {
          // Built-in tool (web search) - Claude handles internally, skip
          state.serverToolBlockIndex = chunk.index;
          break;
        }
        if (block?.type === CLAUDE_BLOCK.TEXT) {
          state.textBlockStarted = true;
        } else if (block?.type === CLAUDE_BLOCK.THINKING) {
          // Track the thinking block internally only. Thinking text flows through
          // reasoning_content (see thinking_delta below) — never inject literal
          // <think>/</think> markers into content. They leak as visible text to any
          // external OpenAI consumer and displace the thinking block from first
          // position when a downstream proxy rebuilds a Claude message.
          state.inThinkingBlock = true;
          state.currentBlockIndex = chunk.index;
        } else if (block?.type === CLAUDE_BLOCK.TOOL_USE) {
          const toolCallIndex = state.toolCallIndex++;
          // Restore original tool name from mapping (Claude OAuth)
          const toolName = state.toolNameMap?.get(block.name) || block.name;
          const toolCall = {
            index: toolCallIndex,
            id: block.id,
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: toolName,
              arguments: ""
            }
          };
          state.toolCalls.set(chunk.index, toolCall);
          results.push(createChunk(state, { tool_calls: [toolCall] }));
        }
        break;
      }

    case "content_block_delta":{
        // Skip deltas for built-in server tool blocks (web search)
        if (chunk.index === state.serverToolBlockIndex) break;
        const delta = chunk.delta;
        if (delta?.type === "text_delta" && delta.text) {
          state.contentEmitted = true;
          results.push(createChunk(state, { content: delta.text }));
        } else if (delta?.type === "thinking_delta" && delta.thinking) {
          results.push(createChunk(state, reasoningDelta(delta.thinking)));
        } else if (delta?.type === "input_json_delta" && delta.partial_json) {
          const toolCall = state.toolCalls.get(chunk.index);
          if (toolCall) {
            toolCall.function.arguments += delta.partial_json;
            results.push(createChunk(state, {
              tool_calls: [{
                index: toolCall.index,
                id: toolCall.id,
                function: { arguments: delta.partial_json }
              }]
            }));
          }
        }
        break;
      }

    case "content_block_stop":{
        // Skip stop for built-in server tool blocks (web search)
        if (chunk.index === state.serverToolBlockIndex) {
          state.serverToolBlockIndex = -1;
          break;
        }
        if (state.inThinkingBlock && chunk.index === state.currentBlockIndex) {
          // End of thinking is signaled by state, not by a literal </think> text
          // chunk. Consumers that need an explicit "reasoning ended" event (#454)
          // detect the reasoning_content → content transition instead
          // (see openai-responses.js).
          state.inThinkingBlock = false;
        }
        state.textBlockStarted = false;
        state.thinkingBlockStarted = false;
        break;
      }

    case "message_delta":{
        // Extract usage from message_delta event (Claude native format).
        // Anthropic sends input/cache in message_start and only output here, so
        // fall back to cache captured in message_start when the delta omits it.
        if (chunk.usage && isObject(chunk.usage)) {
          const prev = state.usage || {};
          const inputTokens = isNumber(chunk.usage.input_tokens) ? chunk.usage.input_tokens : prev.input_tokens || 0;
          const outputTokens = isNumber(chunk.usage.output_tokens) ? chunk.usage.output_tokens : 0;
          const cacheReadTokens = isNumber(chunk.usage.cache_read_input_tokens) ? chunk.usage.cache_read_input_tokens : prev.cache_read_input_tokens || 0;
          const cacheCreationTokens = isNumber(chunk.usage.cache_creation_input_tokens) ? chunk.usage.cache_creation_input_tokens : prev.cache_creation_input_tokens || 0;
          const outputTokensDetails = chunk.usage.output_tokens_details && isObject(chunk.usage.output_tokens_details) ?
          chunk.usage.output_tokens_details :
          prev.output_tokens_details;

          // prompt_tokens = input_tokens + cache_read + cache_creation (all prompt-side tokens)
          const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;

          state.usage = {
            prompt_tokens: promptTokens,
            completion_tokens: outputTokens,
            total_tokens: promptTokens + outputTokens,
            input_tokens: inputTokens,
            output_tokens: outputTokens
          };
          if (outputTokensDetails) state.usage.output_tokens_details = outputTokensDetails;

          if (cacheReadTokens > 0) state.usage.cache_read_input_tokens = cacheReadTokens;
          if (cacheCreationTokens > 0) state.usage.cache_creation_input_tokens = cacheCreationTokens;
        }

        if (chunk.delta?.stop_reason) {
          state.finishReason = convertStopReason(chunk.delta.stop_reason);
          pushSyntheticContentIfEmpty(state, results);
          const finalChunk = createChunk(state, {}, state.finishReason);

          if (state.usage) {
            // Build OpenAI usage from the merged state (cache from message_start +
            // output from message_delta), not the delta chunk alone.
            finalChunk.usage = toOpenAIUsage({
              input_tokens: state.usage.input_tokens || 0,
              output_tokens: state.usage.output_tokens || 0,
              cache_read_input_tokens: state.usage.cache_read_input_tokens,
              cache_creation_input_tokens: state.usage.cache_creation_input_tokens,
              output_tokens_details: state.usage.output_tokens_details
            }, "claude");
          }

          results.push(finalChunk);
          state.finishReasonSent = true;
        }
        break;
      }

    case "message_stop":{
        if (!state.finishReasonSent) {
          const finishReason = state.finishReason || (state.toolCalls?.size > 0 ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP);
          pushSyntheticContentIfEmpty(state, results);
          const finalChunk = createChunk(state, {}, finishReason);
          if (state.usage && isObject(state.usage)) {
            // Same merged cache-aware usage as the message_delta path — reuse
            // toOpenAIUsage so cache_read/cache_creation from message_start are
            // folded into prompt_tokens instead of dropped.
            finalChunk.usage = toOpenAIUsage({
              input_tokens: state.usage.input_tokens || 0,
              output_tokens: state.usage.output_tokens || 0,
              cache_read_input_tokens: state.usage.cache_read_input_tokens,
              cache_creation_input_tokens: state.usage.cache_creation_input_tokens,
              output_tokens_details: state.usage.output_tokens_details
            }, "claude");
          }
          results.push(finalChunk);
          state.finishReasonSent = true;
        }
        break;
      }
  }

  return results.length > 0 ? results : null;
}

const convertStopReason = (reason) => toOpenAIFinish(reason, "claude");

// Register
register(FORMATS.CLAUDE, FORMATS.OPENAI, null, claudeToOpenAIResponse);