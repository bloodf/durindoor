/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */
import { FORMATS } from "../translator/formats.js";
import { MAX_RESPONSES_OUTPUT_ITEMS } from "../config/runtimeConfig.js";
import { readBoundedResponseText } from "../utils/error.js";
import { createUpstreamTerminalTracker } from "../utils/streamTerminal.js";


/**
 * Process a single SSE message and update state accordingly.
 */
import { isFunction, isNumber, isObject } from "../../src/shared/utils/typeChecks.js";
function processSSEMessage(msg, state) {
  if (!msg.trim()) return;
  if (msg.trim().startsWith(":")) return;

  const dataMatch = msg.match(/^data:\s*(.+)$/m);
  if (!dataMatch) {state.terminal.fail();return;}
  const dataStr = dataMatch[1].trim();
  const eventMatch = msg.match(/^event:\s*(.+)$/m);
  if (dataStr === "[DONE]") {
    state.terminal.observe({ rawDone: true, eventName: eventMatch?.[1]?.trim() || null });
    return;
  }
  if (!eventMatch) {state.terminal.fail();return;}
  const eventType = eventMatch[1].trim();

  let parsed;
  try {parsed = JSON.parse(dataStr);}
  catch {state.terminal.fail();return;}

  state.terminal.observe({ chunk: parsed, eventName: eventType });

  if (eventType === "response.created") {
    state.responseId = parsed.response?.id || state.responseId;
    state.created = parsed.response?.created_at || state.created;
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
    }
    if (parsed.response?.usage) {
      const u = parsed.response.usage;
      state.usage.input_tokens = u.input_tokens || 0;
      state.usage.output_tokens = u.output_tokens || 0;
      state.usage.total_tokens = u.total_tokens || 0;
      if (u.cache_read_input_tokens || u.cache_creation_input_tokens) {
        if (u.cache_read_input_tokens) state.usage.cache_read_input_tokens = u.cache_read_input_tokens;
        if (u.cache_creation_input_tokens) state.usage.cache_creation_input_tokens = u.cache_creation_input_tokens;
      }
      const details = u.input_tokens_details || u.prompt_tokens_details;
      if (details && isNumber(details.cached_tokens)) {
        state.usage.cache_read_input_tokens = details.cached_tokens;
      }
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
    responseId: "",
    created: Math.floor(Date.now() / 1000),
    status: "in_progress",
    usage: { ...EMPTY_RESPONSE },
    items: new Map(),
    terminal: createUpstreamTerminalTracker({ format: FORMATS.OPENAI_RESPONSES })
  };

  const raw = await readBoundedResponseText(new Response(stream), options);
  const messages = raw.split(/\r?\n\r?\n/);
  for (const msg of messages) {
    if (msg.trim()) processSSEMessage(msg, state);
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
    created_at: state.created,
    status: state.status,
    output,
    usage: state.usage
  };
}