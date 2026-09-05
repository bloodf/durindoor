/**
 * Translator: OpenAI Chat Completions → OpenAI Responses API (response)
 * Converts streaming chunks from Chat Completions to Responses API events
 *
 * Tool-call shape follows the Responses API spec (OmniRoute #6937): function
 * and custom tool items carry status in_progress/completed, custom tools
 * (apply_patch) stream via custom_tool_call_input.* events, and output_index
 * is offset past a preceding reasoning item so items never collide at 0.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { buildChunk } from "../concerns/chunk.js";
import { buildUsage, toResponsesUsage } from "../concerns/usage.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { reasoningDelta, extractReasoningText } from "../concerns/reasoning.js";
import { isInternalReasoningPlaceholder } from "../../utils/reasoningPlaceholder.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM, OPENAI_FINISH, MODEL_FALLBACK } from "../schema/index.js";

/** Collect events while preserving the stream-wide sequence across deferred completion. */
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
function recordFinalOutputItem(state, eventType, data) {
  if (eventType !== "response.output_item.added" && eventType !== "response.output_item.done") return;
  const outputIndex = Number(data.output_index);
  if (!Number.isInteger(outputIndex) || !data.item) return;
  (state.finalOutputItems ||= [])[outputIndex] = data.item;
}

function createEventEmitter(state) {
  const events = [];
  const emit = (eventType, data) => {
    data.sequence_number = ++state.seq;
    recordFinalOutputItem(state, eventType, data);
    events.push({ event: eventType, data });
  };
  return { events, emit };
}

/**
 * Translate OpenAI chunk to Responses API events
 * @returns {Array} Array of events with { event, data } structure
 */
export function openaiToOpenAIResponsesResponse(chunk, state) {
  if (!chunk) {
    return flushEvents(state);
  }

  if (chunk.model) state.model = chunk.model;
  // Merge rather than overwrite so provider-only fields already extracted
  // into shared state (e.g. Kiro credits) survive the Responses projection.
  if (chunk.usage && isObject(chunk.usage)) {
    state.usage = { ...(state.usage || {}), ...chunk.usage };
  }

  if (!chunk.choices?.length) {
    // Usage-only chunks trail finish_reason when include_usage is enabled upstream.
    // Complete only when usage was actually captured — an empty-choices chunk without
    // usage (or before finish_reason deferred completion) must not complete early.
    if (state.awaitingTrailingUsage && !state.completedSent && state.usage) {
      const { events, emit } = createEventEmitter(state);
      sendCompleted(state, emit);
      return events;
    }
    return [];
  }

  const { events, emit } = createEventEmitter(state);

  const choice = chunk.choices[0];
  const idx = choice.index || 0;
  const delta = choice.delta || {};

  // Emit initial events
  if (!state.started) {
    state.started = true;
    state.responseId = chunk.id ? `resp_${chunk.id}` : state.responseId;

    emit("response.created", {
      type: "response.created",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        model: state.model || MODEL_FALLBACK,
        status: "in_progress",
        background: false,
        error: null,
        output: []
      }
    });

    emit("response.in_progress", {
      type: "response.in_progress",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        model: state.model || MODEL_FALLBACK,
        status: "in_progress"
      }
    });
  }

  // Handle reasoning across vendor shapes (reasoning_content / reasoning / reasoning_details)
  const reasoningText = extractReasoningText(delta);
  if (reasoningText && !isInternalReasoningPlaceholder(reasoningText)) {
    startReasoning(state, emit, idx);
    emitReasoningDelta(state, emit, reasoningText);
  }

  // Handle text content
  if (delta.content) {
    let content = delta.content;

    // Reasoning arrived via reasoning_content (not inline <think> tags) and now
    // normal text begins → the reasoning section is over. Close it here on the
    // state transition, so consumers get an explicit "reasoning ended" event
    // before the first output_text.delta (#454) without translators having to
    // inject literal tag markers into content.
    if (state.reasoningId && !state.reasoningDone && !state.inThinking) {
      closeReasoning(state, emit);
    }

    if (content.includes("<think>")) {
      state.inThinking = true;
      content = content.replace("<think>", "");
      startReasoning(state, emit, idx);
    }

    if (content.includes("</think>")) {
      const parts = content.split("</think>");
      const thinkPart = parts[0];
      const textPart = parts.slice(1).join("</think>");
      if (thinkPart) emitReasoningDelta(state, emit, thinkPart);
      closeReasoning(state, emit);
      state.inThinking = false;
      content = textPart;
    }

    if (state.inThinking && content) {
      emitReasoningDelta(state, emit, content);
      return events;
    }

    if (content) {
      emitTextContent(state, emit, idx, content);
    }
  }

  /** Keep interleaved tool calls from closing text before later deltas arrive. */
  // output_text.done is emitted once finish_reason closes the message.
  if (delta.tool_calls && delta.tool_calls.length) {
    for (const tc of delta.tool_calls) {
      emitToolCall(state, emit, tc);
    }
  }

  // Handle finish_reason
  if (choice.finish_reason) {
    for (const i in state.msgItemAdded) closeMessage(state, emit, i);
    closeReasoning(state, emit);
    for (const i in state.funcCallIds) closeToolCall(state, emit, i);
    if (state.usage) {
      sendCompleted(state, emit);
    } else {
      state.awaitingTrailingUsage = true;
    }
  }

  return events;
}

// Helper functions
function startReasoning(state, emit, idx) {
  if (!state.reasoningId) {
    const outputIndex = state.nextOutputIndex++;
    state.reasoningId = `rs_${state.responseId}_${idx}`;
    state.reasoningIndex = outputIndex;

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { id: state.reasoningId, type: RESPONSES_ITEM.REASONING, summary: [] }
    });

    emit("response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      item_id: state.reasoningId,
      output_index: outputIndex,
      summary_index: 0,
      part: { type: RESPONSES_ITEM.SUMMARY_TEXT, text: "" }
    });
    state.reasoningPartAdded = true;
  }
}

function emitReasoningDelta(state, emit, text) {
  if (!text) return;
  state.reasoningBuf += text;
  emit("response.reasoning_summary_text.delta", {
    type: "response.reasoning_summary_text.delta",
    item_id: state.reasoningId,
    output_index: state.reasoningIndex,
    summary_index: 0,
    delta: text
  });
}

function closeReasoning(state, emit) {
  if (state.reasoningId && !state.reasoningDone) {
    state.reasoningDone = true;

    emit("response.reasoning_summary_text.done", {
      type: "response.reasoning_summary_text.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      text: state.reasoningBuf
    });

    emit("response.reasoning_summary_part.done", {
      type: "response.reasoning_summary_part.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      part: { type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: state.reasoningIndex,
      item: {
        id: state.reasoningId,
        type: RESPONSES_ITEM.REASONING,
        summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }]
      }
    });
  }
}

function emitTextContent(state, emit, idx, content) {
  if (!state.msgItemAdded[idx]) {
    const outputIndex = state.nextOutputIndex++;
    state.msgItemAdded[idx] = true;
    state.msgOutputIndexes[idx] = outputIndex;
    const msgId = `msg_${state.responseId}_${idx}`;

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { id: msgId, type: RESPONSES_ITEM.MESSAGE, content: [], role: ROLE.ASSISTANT }
    });
  }

  const outputIndex = state.msgOutputIndexes[idx];

  if (!state.msgContentAdded[idx]) {
    state.msgContentAdded[idx] = true;

    emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: `msg_${state.responseId}_${idx}`,
      output_index: outputIndex,
      content_index: 0,
      part: { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: "" }
    });
  }

  emit("response.output_text.delta", {
    type: "response.output_text.delta",
    item_id: `msg_${state.responseId}_${idx}`,
    output_index: outputIndex,
    content_index: 0,
    delta: content,
    logprobs: []
  });

  if (!state.msgTextBuf[idx]) state.msgTextBuf[idx] = "";
  state.msgTextBuf[idx] += content;
}

function closeMessage(state, emit, idx) {
  if (state.msgItemAdded[idx] && !state.msgItemDone[idx]) {
    state.msgItemDone[idx] = true;
    const fullText = state.msgTextBuf[idx] || "";
    const msgId = `msg_${state.responseId}_${idx}`;
    const outputIndex = state.msgOutputIndexes[idx];

    emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      text: fullText,
      logprobs: []
    });

    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: fullText }
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item: {
        id: msgId,
        type: RESPONSES_ITEM.MESSAGE,
        content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: fullText }],
        role: ROLE.ASSISTANT
      }
    });
  }
}
function splitToolName(state, name) {
  const namespace = state.toolNamespaces?.[name];
  if (!namespace) return { name };
  const prefix = `${namespace}.`;
  return {
    name: name.startsWith(prefix) ? name.slice(prefix.length) : name,
    namespace
  };
}


function emitToolCall(state, emit, tc) {
  const tcIdx = tc.index ?? 0;
  let outputIndex = state.funcOutputIndexes[tcIdx];
  const newCallId = tc.id;
  const funcName = tc.function?.name;

  if (funcName) state.funcNames[tcIdx] = funcName;

  // apply_patch defaults to custom framing (legacy Codex compatibility), but
  // an explicit function declaration in the request always wins over the name
  // fallback. See OmniRoute #10041.
  const isCustomTool = isCustomToolByState(state, tcIdx, funcName || "");

  // Save id on first sight; if name hasn't arrived yet, emit nothing yet.
  if (newCallId && !state.funcCallIds[tcIdx]) {
    state.funcCallIds[tcIdx] = newCallId;
  }

  // Emit output_item.added only once both id and name are known.
  const refCallId = state.funcCallIds[tcIdx];
  const refName = state.funcNames[tcIdx];
  if (refCallId && refName && !state.funcItemAdded[tcIdx]) {
    state.funcItemAdded[tcIdx] = true;
    outputIndex = state.funcOutputIndexes[tcIdx] = state.nextOutputIndex++;
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: isCustomTool ?
      {
        id: `fc_${refCallId}`,
        type: "custom_tool_call",
        input: "",
        call_id: refCallId,
        name: refName,
        status: "in_progress"
      } :
      {
        id: `fc_${refCallId}`,
        type: RESPONSES_ITEM.FUNCTION_CALL,
        arguments: "",
        call_id: refCallId,
        ...splitToolName(state, refName),
        status: "in_progress"
      }
    });

    // Replay any regular argument deltas that arrived while we were waiting for the name.
    if (!isCustomTool && state.funcPendingArgs[tcIdx]) {
      for (const delta of state.funcPendingArgs[tcIdx]) {
        emit("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          item_id: `fc_${refCallId}`,
          output_index: outputIndex,
          delta
        });
      }
      delete state.funcPendingArgs[tcIdx];
    }
  }

  state.funcArgsBuf[tcIdx] ||= "";

  if (tc.function?.arguments) {
    const delta = tc.function.arguments;
    state.funcArgsBuf[tcIdx] += delta;

    if (!isCustomTool) {
      if (refCallId && refName) {
        emit("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          item_id: `fc_${refCallId}`,
          output_index: outputIndex,
          delta
        });
      } else if (refCallId) {
        // Name not yet known; queue regular delta for replay once name arrives.
        (state.funcPendingArgs[tcIdx] ||= []).push(delta);
      }
    }
  }
}
function isCustomToolByState(state, tcIdx, funcName) {
  const name = state.funcNames[tcIdx] || funcName || "";
  const declaredType = state.toolTypes?.[name] || "";
  return declaredType === "custom" || name === "apply_patch" && !Object.hasOwn(state.toolTypes || {}, name);
}

function closeToolCall(state, emit, idx) {
  const callId = state.funcCallIds[idx];
  if (!state.funcItemAdded[idx]) return;
  if (callId && !state.funcItemDone[idx]) {
    const args = state.funcArgsBuf[idx] || "{}";
    const outputIndex = state.funcOutputIndexes[idx];
    const isCustomTool = isCustomToolByState(state, idx, "");

    if (isCustomTool) {
      // Codex sends a function-call-shaped stream even for custom tools; the
      // arguments are a JSON wrapper {"input":"<patch>"} we must unwrap into
      // raw custom-tool input. Stream the raw input as custom_tool_call_input
      // deltas so concatenated deltas equal the final done input.
      let rawInput = args;
      let parsed = null;
      try {parsed = JSON.parse(args);} catch {/* not JSON */}
      if (parsed && isString(parsed.input)) rawInput = parsed.input;
      state.funcCustomInput[idx] = rawInput;

      if (!state.funcCustomDeltaEmitted[idx]) {
        state.funcCustomDeltaEmitted[idx] = true;
        emit("response.custom_tool_call_input.delta", {
          type: "response.custom_tool_call_input.delta",
          item_id: `fc_${callId}`,
          output_index: outputIndex,
          delta: rawInput
        });
      }

      emit("response.custom_tool_call_input.done", {
        type: "response.custom_tool_call_input.done",
        item_id: `fc_${callId}`,
        output_index: outputIndex,
        input: rawInput
      });

      emit("response.output_item.done", {
        type: "response.output_item.done",
        output_index: outputIndex,
        item: {
          id: `fc_${callId}`,
          type: "custom_tool_call",
          input: rawInput,
          call_id: callId,
          name: state.funcNames[idx] || "",
          status: "completed"
        }
      });
    } else {
      emit("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: `fc_${callId}`,
        output_index: outputIndex,
        arguments: args
      });

      emit("response.output_item.done", {
        type: "response.output_item.done",
        output_index: outputIndex,
        item: {
          id: `fc_${callId}`,
          type: RESPONSES_ITEM.FUNCTION_CALL,
          arguments: args,
          call_id: callId,
          ...splitToolName(state, state.funcNames[idx] || ""),
          status: "completed"
        }
      });
    }

    state.funcItemDone[idx] = true;
    state.funcArgsDone[idx] = true;
  }
}

function sendCompleted(state, emit) {
  if (!state.completedSent) {
    state.completedSent = true;
    const usage = toResponsesUsage(state.usage) || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    emit("response.completed", {
      type: "response.completed",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        model: state.model || MODEL_FALLBACK,
        status: "completed",
        background: false,
        error: null,
        output: (state.finalOutputItems || []).filter(Boolean),
        usage
      }
    });
  }
}

function flushEvents(state) {
  if (state.completedSent) return [];

  const { events, emit } = createEventEmitter(state);

  for (const i in state.msgItemAdded) closeMessage(state, emit, i);
  closeReasoning(state, emit);
  for (const i in state.funcCallIds) closeToolCall(state, emit, i);
  sendCompleted(state, emit);

  return events;
}

// currentToolCallId is intentionally sticky for the current turn so flush/completion
// can still finalize as tool_calls even if the tool call was emitted before stream end.
function computeFinishReason(state) {
  return state.toolCallIndex > 0 || state.currentToolCallId ?
  OPENAI_FINISH.TOOL_CALLS :
  OPENAI_FINISH.STOP;
}

/**
 * Translate OpenAI Responses API chunk to OpenAI Chat Completions format
 * This is for when Codex returns data and we need to send it to an OpenAI-compatible client
 */
export function openaiResponsesToOpenAIResponse(chunk, state) {
  if (!chunk) {
    // Flush: send final chunk with finish_reason
    if (state.finishReasonSent || !state.started) return null;

    const finishReason = computeFinishReason(state);

    state.finishReasonSent = true;
    state.finishReason = finishReason;

    const finalChunk = buildChunk(
      { id: state.chatId || `chatcmpl-${Date.now()}`, created: state.created || Math.floor(Date.now() / 1000), model: state.model || MODEL_FALLBACK },
      {},
      finishReason
    );

    if (state.usage && isObject(state.usage)) {
      finalChunk.usage = state.usage;
    }

    return finalChunk;
  }

  // Handle different event types from Responses API
  const eventType = chunk.type || chunk.event;
  const data = chunk.data || chunk;

  // Initialize state
  if (!state.started) {
    state.started = true;
    state.chatId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.toolCallIndex = 0;
    state.currentToolCallId = null;
  }

  // Text content delta
  if (eventType === "response.output_text.delta") {
    const delta = data.delta || "";
    if (!delta) return null;

    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { content: delta }
    );
  }

  // Text content done (ignore, we handle via delta)
  if (eventType === "response.output_text.done") {
    return null;
  }

  // Function call started (standard function_call or custom_tool_call).
  // Batched parallel calls arrive as several `added` events before any
  // delta or `done`, so each call's index must be allocated here — keyed
  // by call/item ID in `toolCallIdToIndex` — rather than read from the shared
  // `toolCallIndex` counter at delta/done time. That map is what lets
  // later deltas resolve back to the right call regardless of arrival order.
  if (eventType === "response.output_item.added" && (data.item?.type === RESPONSES_ITEM.FUNCTION_CALL || data.item?.type === "custom_tool_call")) {
    const item = data.item;
    const callId = item.call_id || fallbackToolCallId();
    const itemId = isString(item.id) ? item.id : "";
    state.currentToolCallId = callId;

    // Key the per-call index by both `item.id` (what deltas carry as
    // `item_id`, e.g. `fc_001`) and `item.call_id` (what later `output_item.done`
    // references). Real Responses streams may use either, so record both.
    state.toolCallIdToIndex ??= {};
    let callIndex = state.toolCallIdToIndex[itemId] ?? state.toolCallIdToIndex[callId];
    if (callIndex === undefined) {
      callIndex = state.toolCallIndex;
      state.toolCallIdToIndex[callId] = callIndex;
      state.toolCallIndex++;
    }
    if (itemId) state.toolCallIdToIndex[itemId] = callIndex;

    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      {
        tool_calls: [{
          index: callIndex,
          id: callId,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: item.name || "", arguments: "" }
        }]
      }
    );
  }

  // Function call arguments delta (standard or custom_tool_call variant).
  // Resolve the target index from the delta's `item_id` (matching the
  // `item.id` recorded at `output_item.added`) so interleaved deltas from
  // parallel calls land on their own tool_call entry instead of the shared
  // counter. Some providers instead send `fc_<call_id>`/`ctc_<call_id>` —
  // strip that prefix as a second lookup — and streams that omit `item_id`
  // entirely (or send an id this translator doesn't recognize) fall back to
  // the most recently added call's index, matching pre-fix behavior for
  // sequential (non-parallel) streams.
  if (eventType === "response.function_call_arguments.delta" || eventType === "response.custom_tool_call_input.delta") {
    const argsDelta = data.delta || "";
    if (!argsDelta) return null;

    const rawItemId = isString(data.item_id) ? data.item_id : "";
    const strippedItemId = rawItemId.replace(/^(fc|ctc)_/, "");
    const callIndex = state.toolCallIdToIndex?.[rawItemId] ??
    state.toolCallIdToIndex?.[strippedItemId] ??
    state.toolCallIdToIndex?.[state.currentToolCallId] ??
    state.toolCallIndex;

    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { tool_calls: [{ index: callIndex, function: { arguments: argsDelta } }] }
    );
  }

  // Function call done (standard or custom_tool_call variant). The index was
  // already allocated at `output_item.added`, so this is index-neutral —
  // incrementing `toolCallIndex` here would shift indices for calls added
  // after a batch of dones from earlier parallel calls.
  if (eventType === "response.output_item.done" && (data.item?.type === RESPONSES_ITEM.FUNCTION_CALL || data.item?.type === "custom_tool_call")) {
    return null;
  }

  // Response completed or coherently ended incomplete.
  if (eventType === "response.completed" || eventType === "response.done" || eventType === "response.incomplete") {
    // Extract usage from response.completed event
    const responseUsage = data.response?.usage;
    if (responseUsage && isObject(responseUsage)) {
      /** Malformed provider usage must keep the stream transform total. */
      const normalized = toResponsesUsage(responseUsage) || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
      state.usage = buildUsage({
        promptTokens: normalized.input_tokens,
        completionTokens: normalized.output_tokens,
        totalTokens: normalized.total_tokens,
        cachedTokens: normalized.cached_tokens,
        cacheCreationTokens: normalized.cache_creation_input_tokens,
        reasoningTokens: normalized.output_tokens_details?.reasoning_tokens,
        outputTokensDetails: normalized.output_tokens_details
      });
    }

    if (!state.finishReasonSent) {
      const finishReason = eventType === "response.incomplete" ?
      OPENAI_FINISH.LENGTH :
      computeFinishReason(state);

      state.finishReasonSent = true;
      state.finishReason = finishReason; // Mark for usage injection in stream.js

      const finalChunk = buildChunk(
        { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
        {},
        finishReason
      );

      // Include usage in final chunk if available
      if (state.usage && isObject(state.usage)) {
        finalChunk.usage = state.usage;
      }

      return finalChunk;
    }
    return null;
  }

  // Error events from Responses API (e.g. model_not_found)
  if (eventType === "error" || eventType === "response.failed") {
    // Avoid emitting duplicate errors (error + response.failed arrive back-to-back)
    if (state.finishReasonSent) return null;

    const error = data.error || data.response?.error;
    if (error) {
      state.error = error;
      state.finishReasonSent = true;

      // Surface the error as an OpenAI-compatible error chunk
      return buildChunk(
        { id: state.chatId || `chatcmpl-${Date.now()}`, created: state.created || Math.floor(Date.now() / 1000), model: state.model || MODEL_FALLBACK },
        { content: `[Error] ${error.message || JSON.stringify(error)}` },
        OPENAI_FINISH.STOP
      );
    }
    return null;
  }

  // Reasoning summary delta → emit as reasoning_content for client thinking display
  if (eventType === "response.reasoning_summary_text.delta") {
    const delta = data.delta || "";
    if (!delta || isInternalReasoningPlaceholder(delta)) return null;
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      reasoningDelta(delta)
    );
  }

  // Ignore other events
  return null;
}

// Register both directions
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, openaiToOpenAIResponsesResponse);
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, null, openaiResponsesToOpenAIResponse);