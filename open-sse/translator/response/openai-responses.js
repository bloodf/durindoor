/**
 * Translator: OpenAI Chat Completions → OpenAI Responses API (response)
 * Converts streaming chunks from Chat Completions to Responses API events
 *
 * Tool-call shape follows the Responses API spec (OmniRoute #6937): function
 * and custom tool items carry status in_progress/completed, custom tools
 * (apply_patch) stream via custom_tool_call_input.* events, and output_index
 * is offset past a preceding reasoning item so items never collide at 0.
 */
import { register, initState } from "../registry.js";
import { FORMATS } from "../formats.js";
import { bindResponsesTextItem, recordResponsesTextDelta, reconcileResponsesTextDone, synthesizeTextItemSnapshot, finalizeResponsesTextSnapshots, flushResponsesTextSnapshots, closeResponsesTextSnapshots } from "./responsesTextSnapshots.js";
import { buildChunk } from "../concerns/chunk.js";
import { buildUsage, toResponsesUsage } from "../concerns/usage.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { reasoningDelta, extractReasoningText, REASONING_PART_SEPARATOR } from "../concerns/reasoning.js";
import { resolveInlineThinkingFormat } from "../../utils/inlineThinking.js";
import { INLINE_THINKING_FORMATS } from "../../providers/schema.js";
import { createThinkTagStreamExtractor } from "../../utils/thinkStripper.js";
import { isInternalReasoningPlaceholder } from "../../utils/reasoningPlaceholder.js";
import { normalizeArrayContentDelta } from "../../utils/arrayContentDelta.js";
import { sanitizeErrorMessage } from "../../utils/error.js";
import { isCodexMultiAgentPlaintextTool } from "../concerns/codexMultiAgent.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM, OPENAI_FINISH, MODEL_FALLBACK } from "../schema/index.js";
import {
  isUpstreamErrorObject,
  readUpstreamErrorMessage,
  responsesIncompleteDetailsOrOmit,
  responsesTerminalFromChatFinish
} from "../concerns/finishReason.js";

/** Collect events while preserving the stream-wide sequence across deferred completion. */
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { chargeRetained, releaseRetained, replaceRetained, retainedSize } from "../../utils/streamRetainedBudget.js";
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

// Completion usage must contain real integer counts, not a per-chunk zero
// placeholder. Keep cache-inclusive normalization without trusting total_tokens.
function completedUsage(raw) {
  if (!raw || !isObject(raw) || Array.isArray(raw)) return null;
  const input = [raw.input_tokens, raw.prompt_tokens].find(Number.isInteger);
  const output = [raw.output_tokens, raw.completion_tokens].find(Number.isInteger);
  if (input === undefined || output === undefined || input < 0 || output < 0) return null;
  const usage = toResponsesUsage(raw);
  if (!Number.isInteger(usage.input_tokens) || usage.input_tokens + usage.output_tokens <= 0) return null;
  usage.total_tokens = usage.input_tokens + usage.output_tokens;
  for (const [field, count, optional] of [
    ["input_tokens_details", "cached_tokens", ["cache_write_tokens", "cache_creation_tokens"]],
    ["output_tokens_details", "reasoning_tokens", []]
  ]) {
    if (!usage[field]) continue;
    // Keep sibling details while making known counters safe for integer clients.
    for (const key of [count, ...optional.filter((name) => name in usage[field])]) {
      if (!Number.isInteger(usage[field][key]) || usage[field][key] < 0) usage[field][key] = 0;
    }
  }
  return usage;
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
  // Capture Chat-stream error payloads so finish_reason error can sanitize them
  // into response.failed.error (never raw credentials). Null-safe: repo isObject
  // treats null as object. (#1331)
  if (chunk.error != null) {
    state.upstreamError = isUpstreamErrorObject(chunk.error) ?
      chunk.error :
      { message: isString(chunk.error) ? chunk.error : String(chunk.error) };
  }
  // Merge rather than overwrite so provider-only fields already extracted
  // into shared state (e.g. Kiro credits) survive the Responses projection.
  if (chunk.usage && isObject(chunk.usage)) {
    state.usage = { ...(state.usage || {}), ...chunk.usage };
  }
  const responseUsage = chunk.usage ? completedUsage(state.usage) : null;
  if (responseUsage) state.responsesUsage = responseUsage;

  if (!chunk.choices?.length) {
    // Usage-only chunks trail finish_reason when include_usage is enabled upstream.
    // Complete only when usage was actually captured — an empty-choices chunk without
    // usage (or before finish_reason deferred completion) must not complete early.
    if (state.awaitingTrailingUsage && !state.completedSent && state.responsesUsage) {
      const { events, emit } = createEventEmitter(state);
      sendTerminal(state, emit);
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

  // Fold typed content before emitting reasoning so each thinking part is emitted
  // once. Preserve vendor reasoning fields that the fold would otherwise mask.
  if (Array.isArray(delta.content)) {
    const vendorReasoning = extractReasoningText({ ...delta, content: undefined });
    if (isInternalReasoningPlaceholder(vendorReasoning)) {
      delete delta.reasoning_content;
    } else if (vendorReasoning && !delta.reasoning_content) {
      delta.reasoning_content = vendorReasoning;
    }
    normalizeArrayContentDelta(delta);
  }

  // Only the selected transport/model contract permits interpreting textual tags.
  // Keep the requested model in state: a chunk's model is upstream-controlled.
  if (resolveInlineThinkingFormat(state.provider, state.requestedModel, FORMATS.OPENAI) === INLINE_THINKING_FORMATS.THINK_TAGS) {
    const extractor = state.inlineResponsesExtractor ||= createThinkTagStreamExtractor();
    if (delta.reasoning_content != null && !isString(delta.reasoning_content)) {
      const pending = extractor.failOpen();
      trackExtractorHold(state, 0, pending);
      if (pending.content && isString(delta.content)) delta.content = pending.content + delta.content;
    } else if (isString(delta.content)) {
      const input = delta.content;
      const result = extractor.process(input);
      trackExtractorHold(state, input.length, result);
      delta.content = result.content;
      if (result.reasoning) delta.reasoning_content = (delta.reasoning_content || "") + result.reasoning;
    }
    if (choice.finish_reason) {
      const pending = extractor.flush();
      trackExtractorHold(state, 0, pending);
      delta.content = (delta.content || "") + (pending.content || "");
      if (pending.reasoning) delta.reasoning_content = (delta.reasoning_content || "") + pending.reasoning;
    }
  }

  // Handle reasoning across vendor shapes (reasoning_content / reasoning / reasoning_details)
  const reasoningText = extractReasoningText(delta);
  if (reasoningText && !isInternalReasoningPlaceholder(reasoningText)) {
    // Reasoning that resumes after the answer needs a new item: a closed one
    // takes no more deltas (9router #4472). Trailing whitespace is not worth one.
    if (state.reasoningDone && reasoningText.trim()) reopenReasoning(state, emit);
    if (!state.reasoningDone) {
      startReasoning(state, emit, idx);
      emitReasoningDelta(state, emit, reasoningText);
    }
  }

  if (isString(delta.reasoning_encrypted_content) && delta.reasoning_encrypted_content) {
    replaceRetained(state, retainedSize(state.reasoningEncryptedContent), delta.reasoning_encrypted_content.length);
    state.reasoningEncryptedContent = delta.reasoning_encrypted_content;
    startReasoning(state, emit, idx);
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

    if (content) {
      emitMessageContent(state, emit, idx, content, RESPONSES_ITEM.OUTPUT_TEXT);
    }
  }

  if (isString(delta.refusal) && delta.refusal) {
    closeReasoning(state, emit);
    emitMessageContent(state, emit, idx, delta.refusal, RESPONSES_ITEM.REFUSAL);
  }

  /** Keep interleaved tool calls from closing text before later deltas arrive. */
  // output_text.done is emitted once finish_reason closes the message.
  if (delta.tool_calls && delta.tool_calls.length) {
    for (const tc of delta.tool_calls) {
      emitToolCall(state, emit, tc);
    }
  }

  // Handle finish_reason. length/content_filter → incomplete; error → failed;
  // stop/tool_calls (and other clean ends) still complete. (#1331 / #1089)
  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
    for (const i in state.msgItemAdded) closeMessage(state, emit, i);
    closeReasoning(state, emit);
    mintMissingToolCallIds(state, emit);
    for (const i in state.funcCallIds) closeToolCall(state, emit, i);
    if (state.responsesUsage) {
      sendTerminal(state, emit);
    } else {
      state.awaitingTrailingUsage = true;
    }
  }

  return events;
}

// Helper functions

// The inline <think> extractor buffers text until its tags close: what went in
// and has not come out yet is retained. Tag characters it consumes stay counted.
function trackExtractorHold(state, inputLength, output) {
  const held = state.inlineExtractorHeld || 0;
  const next = Math.max(0, held + inputLength - retainedSize(output.content) - retainedSize(output.reasoning));
  replaceRetained(state, held, next);
  state.inlineExtractorHeld = next;
}
function startReasoning(state, emit, idx) {
  if (!state.reasoningId) {
    const outputIndex = state.nextOutputIndex++;
    state.reasoningId = state.reasoningReopened ? `rs_${state.responseId}_${idx}_${outputIndex}` : `rs_${state.responseId}_${idx}`;
    state.reasoningIndex = outputIndex;

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { id: state.reasoningId, type: RESPONSES_ITEM.REASONING, summary: [], status: "in_progress" }
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

function reopenReasoning(state, emit) {
  for (const idx of Object.keys(state.msgItemAdded)) retireMessage(state, emit, idx);
  state.reasoningReopened = true;
  state.reasoningId = "";
  state.reasoningBuf = "";
  state.reasoningDone = false;
  state.reasoningPartAdded = false;
  // The closed item already carried its own encrypted content.
  releaseRetained(state, retainedSize(state.reasoningEncryptedContent));
  delete state.reasoningEncryptedContent;
}

// Close a message item and free its choice slot, so later content opens a new one.
function retireMessage(state, emit, idx) {
  closeMessage(state, emit, idx);
  for (const slots of [state.msgItemAdded, state.msgContentAdded, state.msgItemDone, state.msgTextBuf, state.msgOutputIndexes]) {
    delete slots[idx];
  }
  (state.msgReopened ||= new Set()).add(String(idx));
}

// The first message of a choice keeps the plain id; later ones add their output index.
function messageItemId(state, idx) {
  const base = `msg_${state.responseId}_${idx}`;
  return state.msgReopened?.has(String(idx)) ? `${base}_${state.msgOutputIndexes[idx]}` : base;
}

function messagePart(kind, value) {
  return kind === RESPONSES_ITEM.REFUSAL ?
  { type: RESPONSES_ITEM.REFUSAL, refusal: value } :
  { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: value };
}

function emitReasoningDelta(state, emit, text) {
  if (!text) return;
  chargeRetained(state, text.length);
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

    const item = { id: state.reasoningId, type: RESPONSES_ITEM.REASONING, summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }], status: "completed" };
    if (state.reasoningEncryptedContent) item.encrypted_content = state.reasoningEncryptedContent;
    emit("response.output_item.done", { type: "response.output_item.done", output_index: state.reasoningIndex, item });
  }
}

function emitMessageContent(state, emit, idx, content, kind) {
  state.msgKinds ||= {};
  // Text and refusal are separate message items.
  if (state.msgItemAdded[idx] && state.msgKinds[idx] !== kind) retireMessage(state, emit, idx);

  if (!state.msgItemAdded[idx]) {
    const outputIndex = state.nextOutputIndex++;
    state.msgItemAdded[idx] = true;
    state.msgKinds[idx] = kind;
    state.msgOutputIndexes[idx] = outputIndex;

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { id: messageItemId(state, idx), type: RESPONSES_ITEM.MESSAGE, content: [], role: ROLE.ASSISTANT, status: "in_progress" }
    });
  }

  const outputIndex = state.msgOutputIndexes[idx];
  const itemId = messageItemId(state, idx);

  if (!state.msgContentAdded[idx]) {
    state.msgContentAdded[idx] = true;

    emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: itemId,
      output_index: outputIndex,
      content_index: 0,
      part: messagePart(kind, "")
    });
  }

  const isRefusal = kind === RESPONSES_ITEM.REFUSAL;
  const deltaEvent = isRefusal ? "response.refusal.delta" : "response.output_text.delta";
  emit(deltaEvent, {
    type: deltaEvent,
    item_id: itemId,
    output_index: outputIndex,
    content_index: 0,
    delta: content,
    ...(!isRefusal && { logprobs: [] })
  });

  chargeRetained(state, retainedSize(content));
  if (!state.msgTextBuf[idx]) state.msgTextBuf[idx] = "";
  state.msgTextBuf[idx] += content;
}

function closeMessage(state, emit, idx) {
  if (state.msgItemAdded[idx] && !state.msgItemDone[idx]) {
    state.msgItemDone[idx] = true;
    const fullText = state.msgTextBuf[idx] || "";
    const msgId = messageItemId(state, idx);
    const outputIndex = state.msgOutputIndexes[idx];
    const kind = state.msgKinds?.[idx];
    const isRefusal = kind === RESPONSES_ITEM.REFUSAL;
    const doneEvent = isRefusal ? "response.refusal.done" : "response.output_text.done";

    emit(doneEvent, {
      type: doneEvent,
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      ...(isRefusal ? { refusal: fullText } : { text: fullText, logprobs: [] })
    });

    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      part: messagePart(kind, fullText)
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item: {
        id: msgId,
        type: RESPONSES_ITEM.MESSAGE,
        content: [messagePart(kind, fullText)],
        role: ROLE.ASSISTANT,
        status: "completed"
      }
    });
  }
}
/** Split a dotted `{namespace}.{subtool}` name using the exact map built at initState. */
function splitNamespacedName(state, name) {
  const namespace = state.toolNamespaces?.[name];
  if (!namespace) return null;
  const prefix = `${namespace}.`;
  return {
    name: name.startsWith(prefix) ? name.slice(prefix.length) : name,
    namespace
  };
}

function isDeclaredFlatTool(state, name) {
  const type = state.toolTypes?.[name];
  return Boolean(type) && type !== "namespace";
}

function warnUnresolvedToolName(state, emitted, reason) {
  state._warnedToolNames ||= new Set();
  if (state._warnedToolNames.has(emitted)) return;
  state._warnedToolNames.add(emitted);
  console.warn(`[RESPONSES] unresolved tool-call name "${emitted}" (${reason}), forwarding unchanged`);
}

/**
 * Reverse a request-side alias (translateRequest aliases dotted or overlong names for
 * every target) back to the name the client declared.
 */
export function restoreResponsesToolName(state, name) {
  if (!isString(name)) return name;
  return state.toolNameMap?.get(name) || name;
}

/**
 * Resolve a (restored) provider tool-call name to Responses `name` + `namespace`.
 *
 * Providers sometimes inject a prefix the client never declared (e.g. `functions.exec`
 * for a declared `exec`). Exactly one leading segment is stripped, and only when the
 * remainder is a name this request declared; nothing is matched against a guessed
 * alias table. A current flat declaration wins over a historical namespace both
 * before and after prefix removal. Unresolvable names are logged once and forwarded unchanged.
 */
export function resolveResponsesToolName(state, name) {
  if (!isString(name)) return { name };
  // A flat declaration of this exact name wins over a namespace recovered from
  // the request history: the client declared the dotted name as one ordinary
  // function, so the call must not acquire a namespace (OmniRoute #15974).
  if (isDeclaredFlatTool(state, name)) return { name };
  const exact = splitNamespacedName(state, name);
  if (exact) return exact;

  const dot = name.indexOf(".");
  if (dot === -1) {
    if (state.toolTypes?.[name] === "namespace") {
      warnUnresolvedToolName(state, name, "emitted bare namespace name without a sub-tool");
    }
    return { name };
  }

  // The provider may prefix the upstream alias (`functions.<alias>`), so restore the remainder too.
  const rest = restoreResponsesToolName(state, name.slice(dot + 1));
  if (isDeclaredFlatTool(state, rest)) return { name: rest };
  const injected = splitNamespacedName(state, rest);
  if (injected) return injected;

  warnUnresolvedToolName(state, name, "no declared tool name matches");
  return { name };
}


/**
 * Name resolver for buffered (non-streaming) Responses projections: the same
 * restore + resolve the streaming translator applies per tool call.
 */
export function createResponsesToolNameResolver(requestBody, toolNameMap) {
  const state = { ...initState(FORMATS.OPENAI_RESPONSES, requestBody), toolNameMap };
  return (name) => resolveResponsesToolName(state, restoreResponsesToolName(state, name));
}

function emitToolCall(state, emit, tc) {
  const tcIdx = tc.index ?? 0;
  let outputIndex = state.funcOutputIndexes[tcIdx];
  const newCallId = tc.id;
  const funcName = tc.function?.name;

  if (funcName) {
    const restored = restoreResponsesToolName(state, funcName);
    replaceRetained(state, retainedSize(state.funcNames[tcIdx]), retainedSize(restored));
    state.funcNames[tcIdx] = restored;
  }

  // apply_patch defaults to custom framing (legacy Codex compatibility), but
  // an explicit function declaration in the request always wins over the name
  // fallback. See OmniRoute #10041.
  const isCustomTool = isCustomToolByState(state, tcIdx, funcName || "");

  // Save id on first sight; if name hasn't arrived yet, emit nothing yet.
  if (newCallId && !state.funcCallIds[tcIdx]) {
    chargeRetained(state, retainedSize(newCallId));
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
        ...resolveResponsesToolName(state, refName),
        status: "in_progress"
      } :
      {
        id: `fc_${refCallId}`,
        type: RESPONSES_ITEM.FUNCTION_CALL,
        arguments: "",
        call_id: refCallId,
        ...resolveResponsesToolName(state, refName),
        ...(isCodexMultiAgentPlaintextTool(resolveResponsesToolName(state, refName)) ?
        { encrypted_function_args: [] } :
        null),
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
    chargeRetained(state, delta.length);
    state.funcArgsBuf[tcIdx] += delta;

    if (!isCustomTool) {
      if (refCallId && refName) {
        emit("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          item_id: `fc_${refCallId}`,
          output_index: outputIndex,
          delta
        });
      } else {
        // Id or name not yet known; queue regular delta for replay on output_item.added.
        (state.funcPendingArgs[tcIdx] ||= []).push(delta);
      }
    }
  }
}
/**
 * The Chat client's declared custom tool name for an upstream (possibly aliased)
 * call name, or null when the client did not declare it as custom (#1436).
 */
function declaredChatCustomToolName(state, name) {
  if (!state.chatCustomToolNames?.size || !isString(name)) return null;
  const restored = resolveResponsesToolName(state, state.toolNameMap?.get?.(name) ?? name).name;
  return state.chatCustomToolNames.has(restored) ? restored : null;
}

/**
 * Emit the JSON `{input}` arguments of wrapped custom tool calls whose item never
 * reached output_item.done (truncated or failed stream), so their input is not lost (#1436).
 */
function flushWrappedCustomToolInputs(state) {
  const chunks = [];
  for (const [idx, kind] of state.respCustomToolKinds || []) {
    if (kind !== "wrapped" || state.respToolArgsEmitted?.has(idx)) continue;
    (state.respToolArgsEmitted ??= new Set()).add(idx);
    chunks.push(buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { tool_calls: [{ index: idx, function: { arguments: JSON.stringify({ input: state.respCustomToolInput?.get(idx) || "" }) } }] }
    ));
  }
  return chunks;
}

function isCustomToolByState(state, tcIdx, funcName) {
  // Classify by the resolved name so an injected prefix (`functions.apply_patch`)
  // frames the same way the buffered projector does.
  const resolved = resolveResponsesToolName(state, state.funcNames[tcIdx] || funcName || "");
  // A namespace subtool is a function call (even one named apply_patch) unless
  // the request declared that subtool as custom (upstream #4810).
  if (resolved.namespace) return Boolean(state.namespacedCustomTools?.has(`${resolved.namespace}.${resolved.name}`));
  const name = resolved.name || "";
  const declaredType = state.toolTypes?.[name] || "";
  return declaredType === "custom" || name === "apply_patch" && !Object.hasOwn(state.toolTypes || {}, name);
}

/**
 * Upstreams (vLLM/compat gateways) may omit the id on every fragment. At close
 * time mint a stable id for each named call that never got one, so the item is
 * announced and closed instead of vanishing from response.completed
 * (decolua/9router#5636). Deferred to close so a real id arriving after the name
 * (parallel, out-of-order fragments) still wins.
 */
function mintMissingToolCallIds(state, emit) {
  for (const i in state.funcNames) {
    if (state.funcCallIds[i] || !state.funcNames[i]) continue;
    const idx = Number(i);
    const callId = fallbackToolCallId(idx);
    chargeRetained(state, callId.length);
    state.funcCallIds[i] = callId;
    emitToolCall(state, emit, { index: idx });
  }
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
          ...resolveResponsesToolName(state, state.funcNames[idx] || ""),
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
          ...resolveResponsesToolName(state, state.funcNames[idx] || ""),
          ...(isCodexMultiAgentPlaintextTool(resolveResponsesToolName(state, state.funcNames[idx] || "")) ?
          { encrypted_function_args: [] } :
          null),
          status: "completed"
        }
      });
    }

    state.funcItemDone[idx] = true;
    state.funcArgsDone[idx] = true;
  }
}

/**
 * Emit exactly one Responses terminal for the Chat finish_reason.
 * length / content_filter → response.incomplete; error → response.failed;
 * stop / tool_calls / unset / unknown → response.completed. Stream status is
 * always a canonical string from the event (main's sendCompleted used
 * "completed" even for odd finish_reason). Usage attaches the same way on
 * every terminal when present. Failed.error never echoes upstream text. (#1331)
 */
function sendTerminal(state, emit) {
  if (state.completedSent) return;
  state.completedSent = true;
  state.awaitingTrailingUsage = false;
  const usage = state.responsesUsage;
  const terminal = responsesTerminalFromChatFinish(
    state.finishReason,
    readUpstreamErrorMessage(state.upstreamError)
  );
  const streamStatus = terminal.event === "response.incomplete" ? "incomplete" :
    terminal.event === "response.failed" ? "failed" :
    "completed";
  const incompleteDetails = responsesIncompleteDetailsOrOmit(terminal.incomplete_details);
  emit(terminal.event, {
    type: terminal.event,
    response: {
      id: state.responseId,
      object: "response",
      created_at: state.created,
      model: state.model || MODEL_FALLBACK,
      background: false,
      status: streamStatus,
      error: terminal.error,
      ...(incompleteDetails ? { incomplete_details: incompleteDetails } : null),
      // Drop sparse/null slots — never forward null entries as output items.
      output: (state.finalOutputItems || []).filter(Boolean),
      ...(usage ? { usage } : null)
    }
  });
}

function flushEvents(state) {
  if (state.completedSent) return [];

  const { events, emit } = createEventEmitter(state);

  for (const i in state.msgItemAdded) closeMessage(state, emit, i);
  closeReasoning(state, emit);
  mintMissingToolCallIds(state, emit);
  for (const i in state.funcCallIds) closeToolCall(state, emit, i);
  sendTerminal(state, emit);

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
  return announceAssistantRole(state, translateResponsesChunk(chunk, state));
}

/**
 * Chat Completions streams name the assistant role on their first delta; Responses
 * streams have no event for it. Strict clients drop streamed tool calls without it
 * (OmniRoute #3911).
 */
function announceAssistantRole(state, result) {
  if (!result || state.respRoleAnnounced) return result;
  const delta = [result].flat()[0]?.choices?.[0]?.delta;
  if (delta) {
    delta.role = ROLE.ASSISTANT;
    state.respRoleAnnounced = true;
  }
  return result;
}

// Recursive calls stay here so the role lands on the first chunk in output order.
function translateResponsesChunk(chunk, state, terminalSnapshot = false) {
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

    // A stream that ends with no terminal event still owes buffered custom input.
    const pending = flushWrappedCustomToolInputs(state);
    // A stream that ends with no terminal event still owes the text it held
    // back for source order: release it before the final chunk (#1073).
    const held = flushResponsesTextSnapshots(state);
    return held.length || pending.length ? [...held, ...pending, finalChunk] : finalChunk;
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
    // item_id → chat tool_calls index. Deltas carry item_id; keying on it (not
    // stream position) keeps parallel calls separate when upstream emits all
    // output_item.added events before any done/delta. Lazily created so callers
    // that build their own state object (stream.js) need no changes.
    state.respToolChatIndex ??= new Map();
    // Indices that already received argument deltas (guards done-with-args).
    state.respToolArgsEmitted ??= new Set();
  }
  // A new response starts with no custom-tool framing or buffered input (#1436).
  if (eventType === "response.created") {
    state.respCustomToolKinds?.clear();
    for (const input of state.respCustomToolInput?.values() || []) releaseRetained(state, input.length);
    state.respCustomToolInput?.clear();
    state.respReasoningEmitted = state.respReasoningNeedsBreak = false;
    if (state.responsesTextSnapshots) closeResponsesTextSnapshots(state);
    delete state.responsesTextSnapshots;
  }

  if (eventType === "response.output_item.added" && data.item?.type === RESPONSES_ITEM.MESSAGE) {
    bindResponsesTextItem(state, data.item, data.output_index);
  }

  // Text content delta
  if (eventType === "response.output_text.delta") {
    const delta = data.delta || "";
    if (!isString(delta) || !delta || state.finishReasonSent) return null;
    // A delta waits behind an earlier item that can still owe text: the
    // recovered suffix of that item belongs before this one (#1073).
    const chunks = recordResponsesTextDelta(state, data, delta);
    if (!chunks.length) return null;
    return chunks.length === 1 ? chunks[0] : chunks;
  }

  if (eventType === "response.refusal.delta") {
    if (!isString(data.delta) || !data.delta || state.finishReasonSent) return null;
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { refusal: data.delta }
    );
  }

  // A snapshot may contain a suffix missing from the delta stream.
  if (eventType === "response.output_text.done") {
    const chunks = reconcileResponsesTextDone(state, data, data.text);
    if (!chunks.length) return null;
    return chunks.length === 1 ? chunks[0] : chunks;
  }
  if (eventType === "response.output_item.done" && data.item?.type === RESPONSES_ITEM.MESSAGE) {
    return synthesizeTextItemSnapshot(state, data.item, data.output_index);
  }

  // Function call started (standard function_call or custom_tool_call).
  // Index is assigned here (not on done): attributing deltas by stream position
  // merges parallel calls into index 0 whenever upstream emits all addeds
  // before dones — the client then concatenates N JSON payloads into one
  // tool input and fails validation. Both server correlators are recorded:
  // `item.id` (what deltas carry as `item_id`) and `item.call_id` (what some
  // providers send as the delta/done key instead). (#3772)
  if (eventType === "response.output_item.added" && (data.item?.type === RESPONSES_ITEM.FUNCTION_CALL || data.item?.type === "custom_tool_call")) {
    const item = data.item;
    state.currentToolCallId = item.call_id || fallbackToolCallId();
    state.respToolChatIndex ??= new Map();
    const itemKey = item.id || data.item_id || "";
    const byItem = itemKey ? state.respToolChatIndex.get(itemKey) : undefined;
    const byCall = state.respToolChatIndex.get(state.currentToolCallId);
    const byOutput = Number.isInteger(data.output_index) ? state.respToolOutputIndex?.get(data.output_index) : undefined;
    let idx;
    if (byItem !== undefined || byCall !== undefined || byOutput !== undefined) {
      idx = byItem ?? byCall ?? byOutput; // duplicate added (retry) — reuse
    } else {
      idx = state.toolCallIndex++;
    }
    if (Number.isInteger(data.output_index)) (state.respToolOutputIndex ??= new Map()).set(data.output_index, idx);
    if (itemKey) state.respToolChatIndex.set(itemKey, idx);
    state.respToolChatIndex.set(state.currentToolCallId, idx);

    // A custom_tool_call carries raw (non-JSON) input. A Chat client that
    // declared the tool gets the Chat custom shape; any other client gets a
    // function call whose arguments are wrapped as JSON `{input}` once complete (#1436).
    const customName = item.type === "custom_tool_call" ? declaredChatCustomToolName(state, item.name) : null;
    if (item.type === "custom_tool_call") {
      (state.respCustomToolKinds ??= new Map()).set(idx, customName ? "custom" : "wrapped");
    }
    const kind = state.respCustomToolKinds?.get(idx);
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      {
        tool_calls: [kind === "custom" ? {
          index: idx,
          id: state.currentToolCallId,
          type: "custom",
          custom: { name: customName, input: "" }
        } : {
          index: idx,
          id: state.currentToolCallId,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: item.name || "", arguments: "" }
        }]
      }
    );
  }

  // Function call arguments delta (standard or custom_tool_call variant).
  // Routed by item_id so interleaved parallel fragments stay on their own call.
  // Some providers key deltas by `call_id` or by a prefixed `fc_<id>`/`ctc_<id>`
  // form instead of the item id from output_item.added — try the raw key, the
  // prefix-stripped key, then the most recent call's correlator before falling
  // back to stream position. (#3772)
  if (eventType === "response.function_call_arguments.delta" || eventType === "response.custom_tool_call_input.delta") {
    const argsDelta = data.delta || "";
    if (!argsDelta) return null;

    const rawItemId = isString(data.item_id) ? data.item_id : "";
    const strippedItemId = rawItemId.replace(/^(?:fc|ctc)_/, "");
    const known = (rawItemId ? state.respToolChatIndex?.get(rawItemId) : undefined) ??
    (strippedItemId !== rawItemId ? state.respToolChatIndex?.get(strippedItemId) : undefined) ??
    (state.currentToolCallId ? state.respToolChatIndex?.get(state.currentToolCallId) : undefined);
    const idx = known ?? Math.max(0, (state.toolCallIndex || 1) - 1);
    const kind = state.respCustomToolKinds?.get(idx);
    if (kind === "wrapped") {
      // Raw input becomes JSON only when complete; buffer until the item is done.
      chargeRetained(state, argsDelta.length);
      (state.respCustomToolInput ??= new Map()).set(idx, (state.respCustomToolInput.get(idx) || "") + argsDelta);
      return null;
    }
    state.respToolArgsEmitted ??= new Set();
    state.respToolArgsEmitted.add(idx);
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { tool_calls: [kind === "custom" ? { index: idx, custom: { input: argsDelta } } : { index: idx, function: { arguments: argsDelta } }] }
    );
  }

  // Function call done (standard or custom_tool_call variant).
  // Index was assigned at added-time; nothing to advance. Some upstreams send
  // complete arguments only here (no deltas) — emit them once in that case.
  if (eventType === "response.output_item.done" && (data.item?.type === RESPONSES_ITEM.FUNCTION_CALL || data.item?.type === "custom_tool_call")) {
    const doneItem = data.item;
    const doneKey = doneItem?.id || data.item_id || "";
    // A done-only item still needs the same header and identity as an added item.
    const outputKnown = Number.isInteger(data.output_index) && state.respToolOutputIndex?.has(data.output_index);
    // Snapshot positions identify distinct items; ordinary anonymous done events
    // may still correlate with the most recently started call.
    const anonymousKnown = !(terminalSnapshot && isString(doneItem.name) && doneItem.name) &&
      !doneKey && !doneItem.call_id && state.currentToolCallId &&
      state.respToolChatIndex?.has(state.currentToolCallId);
    if (!outputKnown && !anonymousKnown && !(doneKey && state.respToolChatIndex?.has(doneKey)) &&
        !(doneItem.call_id && state.respToolChatIndex?.has(doneItem.call_id))) {
      const item = { ...doneItem, call_id: doneItem.call_id || fallbackToolCallId() };
      const header = translateResponsesChunk({ type: "response.output_item.added", output_index: data.output_index, item }, state);
      const args = translateResponsesChunk({ type: eventType, output_index: data.output_index, item }, state);
      return [header, ...(Array.isArray(args) ? args : [args])].filter(Boolean);
    }
    const idx = (doneKey ? state.respToolChatIndex?.get(doneKey) : undefined) ??
    (doneItem?.call_id ? state.respToolChatIndex?.get(doneItem.call_id) : undefined) ??
    (Number.isInteger(data.output_index) ? state.respToolOutputIndex?.get(data.output_index) : undefined) ??
    Math.max(0, (state.toolCallIndex || 1) - 1);
    const kind = state.respCustomToolKinds?.get(idx);
    if (kind === "wrapped") {
      const buffered = state.respCustomToolInput?.get(idx);
      const input = buffered ?? (isString(doneItem?.input) ? doneItem.input : "");
      if (state.respToolArgsEmitted?.has(idx)) return null;
      (state.respToolArgsEmitted ??= new Set()).add(idx);
      return buildChunk(
        { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
        { tool_calls: [{ index: idx, function: { arguments: JSON.stringify({ input }) } }] }
      );
    }
    if (kind === "custom") {
      if (state.respToolArgsEmitted?.has(idx) || !isString(doneItem?.input) || !doneItem.input) return null;
      state.respToolArgsEmitted.add(idx);
      return buildChunk(
        { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
        { tool_calls: [{ index: idx, custom: { input: doneItem.input } }] }
      );
    }
    const fullArgs = doneItem?.arguments;
    if (isString(fullArgs) && fullArgs) {
      state.respToolArgsEmitted ??= new Set();
      if (!state.respToolArgsEmitted.has(idx)) {
        state.respToolArgsEmitted.add(idx);
        return buildChunk(
          { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
          { tool_calls: [{ index: idx, function: { arguments: fullArgs } }] }
        );
      }
    }
    return null;
  }

  // Respect the status of generic terminal events before recovering a snapshot.
  if ((eventType === "response.done" || eventType === "response.completed") && data.response?.status === "failed") {
    return translateResponsesChunk({ type: "response.failed", response: { ...data.response, error: data.response.error || { message: "Response failed" } } }, state);
  }
  if ((eventType === "response.done" || eventType === "response.completed") && data.response?.status === "incomplete") {
    return translateResponsesChunk({ type: "response.incomplete", response: data.response }, state);
  }

  // Response completed or coherently ended incomplete.
  if (eventType === "response.completed" || eventType === "response.done" || eventType === "response.incomplete") {
    const textSnapshots = finalizeResponsesTextSnapshots(state, data.response?.output);
    const toolSnapshots = [];
    if (!state.finishReasonSent && eventType !== "response.incomplete" &&
        (data.response?.status == null || data.response.status === "completed") && Array.isArray(data.response?.output)) {
      for (const [output_index, item] of data.response.output.entries()) {
        if (item?.type !== RESPONSES_ITEM.FUNCTION_CALL) continue;
        const result = translateResponsesChunk({ type: "response.output_item.done", output_index, item }, state, true);
        if (result) toolSnapshots.push(...(Array.isArray(result) ? result : [result]));
      }
    }
    closeResponsesTextSnapshots(state);
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
      // A zero counter is a reported cache miss, not missing usage data.
      const cacheCounters = [responseUsage.cache_read_input_tokens, responseUsage.cached_tokens,
        responseUsage.input_tokens_details?.cached_tokens, responseUsage.prompt_tokens_details?.cached_tokens];
      if (cacheCounters.some((value) => isNumber(value) && Number.isFinite(value) && value >= 0)) {
        state.usage.prompt_tokens_details ||= {};
        state.usage.prompt_tokens_details.cached_tokens = normalized.cached_tokens ?? 0;
      }
    }

    if (!state.finishReasonSent) {
      const finishReason = eventType === "response.incomplete" ?
      (data.response?.incomplete_details?.reason === "content_filter" ? OPENAI_FINISH.CONTENT_FILTER : OPENAI_FINISH.LENGTH) :
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

      const pending = flushWrappedCustomToolInputs(state);
      return textSnapshots.length || toolSnapshots.length || pending.length ? [...textSnapshots, ...toolSnapshots, ...pending, finalChunk] : finalChunk;
    }
    const pending = flushWrappedCustomToolInputs(state);
    return pending.length ? pending : null;
  }

  // Error events from Responses API (e.g. model_not_found)
  if (eventType === "error" || eventType === "response.failed") {
    // Avoid emitting duplicate errors (error + response.failed arrive back-to-back)
    if (state.finishReasonSent) return null;

    const error = data.error ?? data.response?.error;
    // Match main: truthy primitives (e.g. error: 5) still surface; null/undefined skip.
    if (error) {
      state.error = error;
      state.finishReasonSent = true;
      // Upstream text is public here: redact credentials like the Chat→Responses
      // response.failed path does (#1374).
      const message = sanitizeErrorMessage(readUpstreamErrorMessage(error) || (
        isUpstreamErrorObject(error) ? JSON.stringify(error) : String(error)
      ));

      // Surface the error as an OpenAI-compatible error chunk
      const errorChunk = buildChunk(
        { id: state.chatId || `chatcmpl-${Date.now()}`, created: state.created || Math.floor(Date.now() / 1000), model: state.model || MODEL_FALLBACK },
        { content: `[Error] ${message}` },
        OPENAI_FINISH.STOP
      );
      // A failed stream still owes the text it already streamed: release it
      // before the error so no text is dropped (#1073).
      const held = flushResponsesTextSnapshots(state);
      const pending = flushWrappedCustomToolInputs(state);
      return held.length || pending.length ? [...held, ...pending, errorChunk] : errorChunk;
    }
    return null;
  }

  // Each summary part is a separate thought: break before the next one's text.
  if (eventType === "response.reasoning_summary_part.added") {
    if (state.respReasoningEmitted) state.respReasoningNeedsBreak = true;
    return null;
  }

  // Copilot can rotate reasoning item IDs between deltas and the final
  // snapshot. Match both identifiers to replay only summaries we never streamed.
  const reasoningEvents = state.responsesReasoningEvents ??= { ids: new Set(), indexes: new Set() };
  let summary;
  if (eventType === "response.reasoning_summary_text.delta" || eventType === "response.reasoning_text.delta") {
    summary = data.delta;
    if (!isString(summary) || !summary || isInternalReasoningPlaceholder(summary)) return null;
    if (data.item_id) reasoningEvents.ids.add(data.item_id);
    if (Number.isInteger(data.output_index)) reasoningEvents.indexes.add(data.output_index);
  } else if (eventType === "response.output_item.done" && data.item?.type === RESPONSES_ITEM.REASONING) {
    if (reasoningEvents.ids.has(data.item.id) || reasoningEvents.indexes.has(data.output_index)) return null;
    summary = Array.isArray(data.item.summary) ? data.item.summary
      .filter(part => part?.type === RESPONSES_ITEM.SUMMARY_TEXT && isString(part.text))
      .map(part => part.text)
      .join("\n") : "";
    if (!summary || isInternalReasoningPlaceholder(summary)) return null;
    if (data.item.id) reasoningEvents.ids.add(data.item.id);
    if (Number.isInteger(data.output_index)) reasoningEvents.indexes.add(data.output_index);
  }
  if (summary) {
    const text = state.respReasoningNeedsBreak ? REASONING_PART_SEPARATOR + summary : summary;
    state.respReasoningNeedsBreak = false;
    state.respReasoningEmitted = true;
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      reasoningDelta(text)
    );
  }

  // Ignore other events
  return null;
}

// Register both directions
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, openaiToOpenAIResponsesResponse);
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, null, openaiResponsesToOpenAIResponse);
