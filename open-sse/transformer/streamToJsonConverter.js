/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */
import { createSseFrameReader } from "../utils/sseFrames.js";
import { FORMATS } from "../translator/formats.js";
import { MAX_RESPONSES_OUTPUT_ITEMS } from "../config/runtimeConfig.js";
import { readBoundedResponseText } from "../utils/error.js";
import { toResponsesUsage } from "../translator/concerns/usage.js";
import { responsesIncompleteDetailsOrOmit } from "../translator/concerns/finishReason.js";
import { createUpstreamTerminalTracker } from "../utils/streamTerminal.js";
import { isProviderKeepaliveEvent } from "../utils/providerKeepalive.js";
import { isFunction, isObject, isString } from "../../src/shared/utils/typeChecks.js";

function readResponseMetadata(response) {
  const id = response?.id;
  const created = response?.created_at;
  return {
    id: isString(id) && id.trim() ? id : undefined,
    created: Number.isSafeInteger(created) && created >= 0 ? created : undefined,
  };
}

/**
 * Process a single SSE message and update state accordingly.
 */
function processSSEMessage(msg, state) {
  const { raw, data: dataStr, eventName, hasData } = msg;
  if (!raw.trim()) return;
  const nonCommentLines = raw.split(/\r\n|\r|\n/).filter((line) => line && !line.startsWith(":"));
  if (nonCommentLines.length === 0) return;

  if (
    isProviderKeepaliveEvent(nonCommentLines[0]) &&
    nonCommentLines.slice(1).every((line) => /^data: ?$/.test(line))
  ) {
    return;
  }

  const trimmedData = dataStr.trim();
  if (!hasData || !trimmedData) {state.terminal.fail();return;}
  if (trimmedData === "[DONE]") {
    state.terminal.observe({ rawDone: true, eventName: eventName?.trim() || null });
    return;
  }

  let parsed;
  try {parsed = JSON.parse(dataStr);}
  catch {state.terminal.fail();return;}

  // Some providers omit `event:` lines and send data-only SSE. The Responses API
  // always sets `type` in the payload, so fall back to it (#5607); a frame with
  // neither is still unusable.
  const eventType = eventName?.trim() || (isString(parsed?.type) && parsed.type ? parsed.type : null);
  if (!eventType) {state.terminal.fail();return;}

  state.terminal.observe({ chunk: parsed, eventName: eventType });

  if (eventType === "response.created") {
    const { id, created } = readResponseMetadata(parsed.response);
    state.responseId = id ?? state.responseId;
    state.created = created ?? state.created;
  } else if (eventType === "response.output_item.done") {
    const outputIndex = parsed.output_index ?? 0;
    if (
    !Number.isSafeInteger(outputIndex) ||
    outputIndex < 0 ||
    outputIndex >= MAX_RESPONSES_OUTPUT_ITEMS ||
    state.items.has(outputIndex) ||
    !parsed.item || !isObject(
      parsed.item) ||
    Array.isArray(parsed.item))
    {
      state.terminal.fail();
      return;
    }
    state.items.set(outputIndex, parsed.item);
  } else if (["response.completed", "response.done", "response.incomplete"].includes(eventType)) {
    if (state.terminal.outcome === "success") {
      state.status = eventType === "response.incomplete" ? "incomplete" : "completed";
      // Keep the cap reason (max_output_tokens / content_filter) the client would
      // have received on the streaming path.
      if (eventType === "response.incomplete") {
        state.incompleteDetails = responsesIncompleteDetailsOrOmit(parsed.response?.incomplete_details);
      }
      // Terminal snapshots can contain items that never had an item.done frame.
      // Keep observed items authoritative and apply the same bounds and shape checks.
      const output = parsed.response?.output;
      if (output !== undefined) {
        if (!Array.isArray(output) || output.length > MAX_RESPONSES_OUTPUT_ITEMS ||
            output.some((item) => !item || !isObject(item) || Array.isArray(item))) {
          state.terminal.fail();
          return;
        }
        output.forEach((item, index) => {
          if (!state.items.has(index)) state.items.set(index, item);
        });
      }
      const { id, created } = readResponseMetadata(parsed.response);
      state.responseId ??= id;
      state.created ??= created;
    }
    if (parsed.response?.usage) {
      // Normalize aliases and flat provider fields without discarding any
      // standard input/output detail keys from the completed Responses event.
      state.usage = toResponsesUsage(parsed.response.usage) || state.usage;
    }
  }
}

const EMPTY_RESPONSE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

/**
 * Convert Responses API SSE stream to single JSON response
 * @param {ReadableStream} stream - SSE stream from provider
 * @returns {Promise<Object>} Final JSON response in Responses API format
 */
export async function convertResponsesStreamToJson(stream, options = {}) {
  if (!stream || !isFunction(stream.getReader)) {
    return { id: `resp_${Date.now()}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "failed", output: [], usage: { ...EMPTY_RESPONSE } };
  }

  const state = {
    responseId: undefined,
    created: undefined,
    fallbackCreated: Math.floor(Date.now() / 1000),
    status: "in_progress",
    usage: { ...EMPTY_RESPONSE },
    items: new Map(),
    terminal: createUpstreamTerminalTracker({ format: FORMATS.OPENAI_RESPONSES })
  };

  const raw = await readBoundedResponseText(new Response(stream), options);
  const reader = createSseFrameReader();
  for (const msg of [...reader.push(raw), ...reader.flush()]) {
    processSSEMessage(msg, state);
  }

  if (state.terminal.outcome !== "success") state.status = "failed";

  // Build only a bounded dense sequence. Sparse or duplicate provider indexes
  // are malformed and must never drive attacker-sized array allocation.
  const outputIndexes = [...state.items.keys()].sort((left, right) => left - right);
  if (outputIndexes.some((value, position) => value !== position)) {
    state.terminal.fail();
    state.status = "failed";
  }
  const output = outputIndexes.map((index) => state.items.get(index));

  return {
    id: state.responseId || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    created_at: state.created ?? state.fallbackCreated,
    status: state.status,
    ...(state.status === "incomplete" && state.incompleteDetails ? { incomplete_details: state.incompleteDetails } : null),
    output,
    usage: state.usage
  };
}
