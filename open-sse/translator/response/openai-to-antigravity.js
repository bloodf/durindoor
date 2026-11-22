import { register } from "../registry.js";
import { FORMATS } from "../formats.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { buildGeminiUsageMetadata } from "./geminiUsageMetadata.js";
import { GEMINI_ROLE, OPENAI_FINISH, GEMINI_FINISH } from "../schema/index.js";

// Convert OpenAI SSE chunk to Antigravity SSE format
// Real Antigravity format:
//   data: {"response":{"candidates":[{"content":{"role":"model","parts":[...]}, "finishReason":"STOP"}], "usageMetadata":{...}, "modelVersion":"...", "responseId":"..."}}
// Tool calls: OpenAI sends incremental args across chunks → accumulate and emit ONCE at finish
export function openaiToAntigravityResponse(chunk, state) {
  if (!chunk) return null;

  const choice = chunk.choices?.[0];
  if (!choice) {
    // A usage-only chunk (`choices: []`) is the trailing frame an OpenAI upstream
    // sends when `stream_options.include_usage` is on. Before the finish chunk it
    // is stashed for that chunk; after it, the frame is forwarded as usage
    // metadata of its own instead of being dropped (OmniRoute #18643).
    return chunk.usage ? usageOnlyChunkResponse(chunk.usage, state) : null;
  }

  const delta = choice.delta || {};
  const finishReason = choice.finish_reason;

  // Init state
  if (!state._toolCallAccum) state._toolCallAccum = {};
  if (!state._responseId) state._responseId = chunk.id || `resp_${Date.now()}`;
  if (!state._modelVersion) state._modelVersion = chunk.model || "";

  const parts = [];

  // Thinking/reasoning → thought part, including the vendor aliases
  // (`reasoning`, `reasoning_details[]`) some lanes stream instead (upstream
  // b8331283), so an alias-only chunk is not dropped as empty.
  const reasoningText = extractReasoningText(delta);
  if (reasoningText) {
    parts.push({ thought: true, text: reasoningText });
  }

  // Text content
  if (delta.content) {
    parts.push({ text: delta.content });
  }

  // Accumulate tool calls silently (no emit until finish)
  //
  // Fragment ownership contract (streamed tool calls, Antigravity/Gemini family):
  //   1. An explicit `index` on a fragment owns that fragment outright.
  //   2. An explicit `id` that matches a call already open in this stream owns
  //      the fragment, wherever that call sits in the index space.
  //   3. A new `id` binds a uniquely unbound call, or opens another call.
  //   4. A fragment with neither `index` nor `id` continues the call that owned
  //      the previous fragment (the most recently active call), not the call
  //      with the highest index. Providers interleave calls and then resume an
  //      earlier one, so the highest index is not the owner.
  //   5. With exactly one call open, an indexless fragment still belongs to it
  //      (unchanged single-call behaviour).
  //   6. With several calls open and no active owner known, the fragment is
  //      dropped rather than guessed onto an unrelated call.
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const indexes = Object.keys(state._toolCallAccum).map(Number);
      const latest = indexes.length ? Math.max(...indexes) : 0;
      const known = tc.id ? indexes.find((i) => state._toolCallAccum[i].id === tc.id) : undefined;
      // The call that owned the previous fragment stays the owner of an
      // indexless continuation, even when a later call has a higher index.
      const active = Number.isInteger(state._activeToolIndex) && state._toolCallAccum[state._activeToolIndex]
        ? state._activeToolIndex
        : undefined;
      // Ownership rules, in order: explicit index, explicit id, a new id opens
      // a new call, then the most recently active call.
      let idx;
      let bindUnbound = false;
      if (Number.isInteger(tc.index)) {
        idx = tc.index;
      } else if (known !== undefined) {
        idx = known;
      } else if (tc.id) {
        const unbound = indexes.filter((i) => !state._toolCallAccum[i].id);
        const compatible = unbound.length === 1 && (!tc.function?.name ||
          !state._toolCallAccum[unbound[0]].name || state._toolCallAccum[unbound[0]].name === tc.function.name);
        idx = compatible ? unbound[0] : (indexes.length ? latest + 1 : latest);
        bindUnbound = compatible;
      } else if (active !== undefined) {
        idx = active;
      } else if (indexes.length <= 1) {
        idx = indexes.length ? indexes[0] : latest;
      } else {
        idx = undefined;
      }
      // No ownership evidence and several open calls: the fragment cannot be
      // attributed without guessing, so it is dropped instead of being written
      // into an unrelated call.
      if (idx === undefined) continue;
      if (!state._toolCallAccum[idx]) {
        state._toolCallAccum[idx] = { id: "", name: "", arguments: "" };
      }
      const accum = state._toolCallAccum[idx];
      if (tc.id) accum.id = tc.id;
      if (tc.function?.name && !(bindUnbound && accum.name === tc.function.name)) accum.name += tc.function.name;
      if (tc.function?.arguments) accum.arguments += tc.function.arguments;
      state._activeToolIndex = idx;
    }
    // Skip emit — wait for finish_reason
    if (parts.length === 0 && !finishReason) return null;
  }

  // On finish, emit accumulated tool calls as complete functionCall parts
  if (finishReason) {
    const indices = Object.keys(state._toolCallAccum);
    for (const idx of indices) {
      const accum = state._toolCallAccum[idx];
      let args = {};
      try { args = JSON.parse(accum.arguments); } catch { /* empty */ }
      // Restore original tool name if it was prefixed during cloaking
      const originalName = state.toolNameMap?.get(accum.name) || accum.name;
      parts.push({
        functionCall: {
          ...(accum.id ? { id: accum.id } : null),
          name: originalName,
          args
        }
      });
    }
  }

  // Skip empty non-finish chunks
  if (parts.length === 0 && !finishReason) return null;

  // Ensure at least empty text part on finish with no content
  if (parts.length === 0 && finishReason) {
    parts.push({ text: "" });
  }

  // Build candidate
  const candidate = { content: { role: GEMINI_ROLE.MODEL, parts } };

  // Finish reason mapping
  if (finishReason) {
    // The terminal candidate is out from here: a later usage-only chunk must be
    // forwarded as usage metadata and must not reopen or repeat this candidate.
    state._finishSent = true;
    const reasonMap = {
      [OPENAI_FINISH.STOP]: GEMINI_FINISH.STOP,
      [OPENAI_FINISH.LENGTH]: GEMINI_FINISH.MAX_TOKENS,
      [OPENAI_FINISH.TOOL_CALLS]: GEMINI_FINISH.STOP,
      [OPENAI_FINISH.CONTENT_FILTER]: GEMINI_FINISH.SAFETY,
      [OPENAI_FINISH.ERROR]: GEMINI_FINISH.OTHER
    };
    candidate.finishReason = reasonMap[finishReason] || GEMINI_FINISH.STOP;
  }

  // Build response
  const response = {
    candidates: [candidate],
    modelVersion: state._modelVersion,
    responseId: state._responseId
  };

  // Usage metadata
  const usage = chunk.usage || state._usage;
  if (usage) {
    response.usageMetadata = buildGeminiUsageMetadata(usage);
    // Usage already went out on this frame: a later trailing usage-only chunk
    // must not repeat it.
    state._usageSent = true;
  }

  return { response };
}

// OpenAI upstreams called with `stream_options.include_usage` send the usage in
// a separate final chunk with `choices: []`, after the finish chunk. The finish
// chunk is already out by then, so forward the usage as its own frame (an empty
// text part, no finishReason) unless usage already went out. Usage seen before
// the finish chunk stays stashed for it (see openaiToAntigravityResponse).
function usageOnlyChunkResponse(usage, state) {
  if (!state._finishSent) {
    state._usage = usage;
    return null;
  }
  if (state._usageSent) return null;
  state._usageSent = true;
  return {
    response: {
      candidates: [{ content: { role: GEMINI_ROLE.MODEL, parts: [{ text: "" }] } }],
      modelVersion: state._modelVersion,
      responseId: state._responseId,
      usageMetadata: buildGeminiUsageMetadata(usage)
    }
  };
}

// Register
register(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, null, openaiToAntigravityResponse);
