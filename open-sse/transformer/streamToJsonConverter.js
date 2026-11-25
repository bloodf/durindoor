/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */
import { createSseFrameReader, parseResponsesSseData } from "../utils/sseFrames.js";
import { FORMATS } from "../translator/formats.js";
import { MAX_RESPONSES_OUTPUT_ITEMS } from "../config/runtimeConfig.js";
import { readBoundedResponseText } from "../utils/error.js";
import { toResponsesUsage } from "../translator/concerns/usage.js";
import { responsesIncompleteDetailsOrOmit } from "../translator/concerns/finishReason.js";
import { createUpstreamTerminalTracker } from "../utils/streamTerminal.js";
import { isProviderKeepaliveEvent } from "../utils/providerKeepalive.js";
import { isFunction, isObject, isRecord, isString } from "../../src/shared/utils/typeChecks.js";

function readResponseMetadata(response) {
  const id = response?.id;
  const created = response?.created_at;
  return {
    id: isString(id) && id.trim() ? id : undefined,
    created: Number.isSafeInteger(created) && created >= 0 ? created : undefined,
  };
}

/** Delta event -> the draft field its fragments accumulate in. */
const DELTA_FIELDS = new Map([
  ["response.output_text.delta", { field: "text", type: "message" }],
  ["response.reasoning_summary_text.delta", { field: "summary", type: "reasoning" }],
  ["response.function_call_arguments.delta", { field: "arguments", type: "function_call" }],
  ["response.custom_tool_call_input.delta", { field: "input", type: "custom_tool_call" }],
]);

const isOutputIndex = (value) => Number.isSafeInteger(value) && value >= 0 && value < MAX_RESPONSES_OUTPUT_ITEMS;

/** Keep what `output_item.added` and the delta events say, for streams that never send a finished item. */
function observeDraft(eventType, parsed, state) {
  const delta = DELTA_FIELDS.get(eventType);
  if (!delta && eventType !== "response.output_item.added") return;
  const index = parsed.output_index ?? state.draftIds.get(parsed.item_id) ?? 0;
  if (!isOutputIndex(index)) return;
  const draft = state.drafts.get(index) || {};
  if (!delta) {
    if (!isRecord(parsed.item)) return;
    if (isString(parsed.item.id)) state.draftIds.set(parsed.item.id, index);
    state.drafts.set(index, { ...draft, item: parsed.item });
  } else if (isString(parsed.delta)) {
    state.drafts.set(index, { ...draft, type: delta.type, [delta.field]: (draft[delta.field] || "") + parsed.delta });
  }
}

function itemFromDraft({ item, type, text, summary, arguments: args, input }) {
  const base = item || (type === "message" ? { type, role: "assistant" } : { type });
  if (text !== undefined) return { ...base, content: [{ type: "output_text", text }] };
  if (summary !== undefined) return { ...base, summary: [{ type: "summary_text", text: summary }] };
  if (args !== undefined) return { ...base, arguments: args };
  if (input !== undefined) return { ...base, input };
  return base;
}

/**
 * Rebuild output only when the stream carried content in deltas and no finished
 * item at all, neither as `output_item.done` nor in the terminal snapshot.
 */
function itemsFromDrafts(drafts) {
  if (![...drafts.values()].some((draft) => draft.type)) return new Map();
  return new Map([...drafts].map(([index, draft]) => [index, itemFromDraft(draft)]));
}

/**
 * Process a single SSE message and update state accordingly.
 */
function processSSEMessage(msg, state) {
  const { raw, eventName } = msg;
  if (!raw.trim()) return;
  const nonCommentLines = raw.split(/\r\n|\r|\n/).filter((line) => line && !line.startsWith(":"));
  if (nonCommentLines.length === 0) return;

  if (
    isProviderKeepaliveEvent(nonCommentLines[0]) &&
    nonCommentLines.slice(1).every((line) => /^data: ?$/.test(line))
  ) {
    return;
  }

  let parsed;
  let rawDone;
  try {
    ({ parsed, rawDone } = parseResponsesSseData(msg));
  } catch {
    state.terminal.fail();
    return;
  }
  if (rawDone) {
    state.terminal.observe({ rawDone: true, eventName: eventName?.trim() || null });
    return;
  }
  if (!isRecord(parsed)) {
    state.terminal.fail();
    return;
  }

  // Some providers omit `event:` lines and send data-only SSE. The Responses API
  // always sets `type` in the payload, so fall back to it (#5607); a frame with
  // neither is still unusable.
  const eventType = eventName?.trim() || (isString(parsed?.type) && parsed.type ? parsed.type : null);
  if (!eventType) {state.terminal.fail();return;}

  state.terminal.observe({ chunk: parsed, eventName: eventType });
  observeDraft(eventType, parsed, state);

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
    drafts: new Map(),
    draftIds: new Map(),
    terminal: createUpstreamTerminalTracker({ format: FORMATS.OPENAI_RESPONSES })
  };

  const raw = await readBoundedResponseText(new Response(stream), options);
  const reader = createSseFrameReader();
  for (const msg of [...reader.push(raw), ...reader.flush()]) {
    processSSEMessage(msg, state);
  }

  if (state.terminal.outcome !== "success") state.status = "failed";

  if (state.status !== "failed" && state.items.size === 0) state.items = itemsFromDrafts(state.drafts);

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
