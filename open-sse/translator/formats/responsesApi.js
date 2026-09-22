import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const STORED_ITEM_REFERENCE_PATTERN = /^(?:at|msg|amsg|rs|lsh|fc|tsc|fco|ctc|ctco|tso|ws|ig|cmp|resp)_/;
const STATELESS_CALL_ITEM_TYPES = new Set([
RESPONSES_ITEM.FUNCTION_CALL,
RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
RESPONSES_ITEM.CUSTOM_TOOL_CALL,
RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT]
);

/**
 * Remove stored references and optional item IDs from stateless Responses call replays.
 * `call_id` remains the stable correlation key; IDs on non-call items are preserved.
 * @param {unknown} input Responses API input.
 * @returns {unknown} Normalized input without resolvable stored-item dependencies.
 */
export function normalizeStatelessResponseInput(input) {
  if (!Array.isArray(input)) return input;

  return input.flatMap((item) => {
    if (isString(item) && STORED_ITEM_REFERENCE_PATTERN.test(item)) return [];
    if (!item || !isObject(item) || Array.isArray(item)) return [item];
    if (item.type === RESPONSES_ITEM.ITEM_REFERENCE) return [];
    if (!STATELESS_CALL_ITEM_TYPES.has(item.type) || !Object.hasOwn(item, "id")) return [item];

    const normalizedItem = { ...item };
    delete normalizedItem.id;
    return [normalizedItem];
  });
}

/**
 * Normalize Responses API input to array format.
 * Accepts string or array, returns array of message items.
 * An empty array is treated like an empty string — providers require at least one user
 * message, so we inject a placeholder rather than forwarding an empty messages[].
 * @param {string|Array} input - raw input from Responses API body
 * @returns {Array|null} normalized array or null if invalid
 */
export function normalizeResponsesInput(input) {
  if (isString(input)) {
    const text = input.trim() === "" ? "..." : input;
    return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text }] }];
  }
  if (Array.isArray(input)) {
    // Empty input[] would produce messages:[] which all providers reject (#389)
    if (input.length === 0) {
      return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "..." }] }];
    }
    return input;
  }
  return null;
}

// Strict Responses upstreams reject overlong call_ids with InputValidationError (#393).
export const MAX_RESPONSES_CALL_ID_LEN = 64;

// Fallback ids share one Date.now() when a batch of items is sanitized in a tight
// loop — a per-process sequence keeps same-millisecond ids unique so
// function_call ↔ function_call_output correlation never collides.
let responsesCallIdSeq = 0;

export function clampResponsesCallId(id) {
  if (!isString(id) || !id) return `call_${Date.now()}_${(responsesCallIdSeq += 1)}`;
  return id.length > MAX_RESPONSES_CALL_ID_LEN ? id.substring(0, MAX_RESPONSES_CALL_ID_LEN) : id;
}

// Every caller that turns a tool name into a lookup/wire key trims and caps
// it to this length (opencode-go.js, request/openai-responses.js) before a
// strict Responses upstream sees it (#393-style length limits). Declaration
// keys must be normalized the same way or a padded/overlong name silently
// misses its declaration (upstream #4208 review, round 4).
const MAX_DECLARED_TOOL_NAME_LEN = 128;

function normalizeToolNameKey(name) {
  return isString(name) ? name.trim().slice(0, MAX_DECLARED_TOOL_NAME_LEN) : "";
}

// Build a name -> declared tool type ("custom", "function", ...) lookup from
// a request's declared tools[]. Mirrors initState's toolTypes resolution
// (translator/index.js) exactly: `function.name` wins over a flat `name`
// regardless of `type` — a Responses "custom" tool can still nest its name
// under `function` ({type:"custom", function:{name}}, see
// tests/translator/port-6937-responses-toolcall-shape.test.js). Optional
// chaining on `tool.function?.name` also means a null/non-object `function`
// field never throws (upstream #4208 review, round 3) — no isObject check
// needed. Callers pass the result to coerceResponsesArguments so a name
// match wins over the apply_patch legacy fallback.
export function buildDeclaredToolTypes(tools) {
  const declared = new Map();
  if (!Array.isArray(tools)) return declared;
  for (const tool of tools) {
    if (!tool) continue;
    const type = isString(tool.type) ? tool.type : "";
    const name = normalizeToolNameKey(isString(tool.function?.name) ? tool.function.name : tool.name);
    if (name && type) declared.set(name, type);
  }
  return declared;
}

// Resolve a tool name against buildDeclaredToolTypes()'s output: true when
// declared "custom", false when declared as an ordinary function (including
// "apply_patch"), undefined when the request never declares this name at all.
// Normalizes `toolName` the same way buildDeclaredToolTypes normalizes its
// keys, so it doesn't matter whether a caller's lookup name is raw, trimmed,
// or already length-capped — they all resolve to the same key.
export function resolveDeclaredCustom(declaredToolTypes, toolName) {
  const key = normalizeToolNameKey(toolName);
  if (!declaredToolTypes || !key || !declaredToolTypes.has(key)) return undefined;
  return declaredToolTypes.get(key) === "custom";
}

// Single-stringify: objects → JSON once; valid JSON strings pass through untouched;
// anything else (partial fragments, empty) falls back to "{}" instead of
// double-encoding and tripping upstream InputValidationError.
//
// Declared Responses "custom" (freeform) tools carry raw text in "arguments",
// never JSON, by design - apply_patch is the one that ships without a
// declared tool entry (legacy Codex compatibility), so it is still recognized
// by name. Losing that text to "{}" silently drops the tool body on chat
// replay, so it gets wrapped as { input: <raw text> } instead - the same shape
// the request translator already gives custom tools (see the
// `tool.type === "custom"` branch in request/openai-responses.js). Ordinary
// malformed/truncated function JSON still falls back to "{}".
//
// `declaredCustom` is a tri-state, not a boolean: pass `true`/`false` when the
// caller resolved the name against buildDeclaredToolTypes() (a "function"
// declaration always wins, even for the name "apply_patch" — matches
// isCustomToolByState in response/openai-responses.js). Leave it `undefined`
// only when the caller has no declared-tools state at all, which falls back
// to the apply_patch name check for legacy Codex compatibility.
export function coerceResponsesArguments(value, toolName, declaredCustom) {
  if (value === undefined || value === null || value === "") return "{}";
  if (!isString(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      // Circular reference or BigInt — same data loss as the parse-failure
      // path below, so log it the same way (author note, round 4: this
      // substitution itself is intended upstream #4208 behavior; only a
      // silent stringify failure was the gap).
      console.warn(`[Translator] Tool call arguments object for "${toolName || "(unnamed)"}" could not be JSON-stringified, coerced to "{}"`);
      return "{}";
    }
  }
  try {
    JSON.parse(value);
    return value;
  } catch {
    if (declaredCustom === true) return JSON.stringify({ input: value });
    if (toolName === "apply_patch" && declaredCustom !== false) return JSON.stringify({ input: value });
    // Every remaining path drops non-empty, non-JSON text: a declared function
    // whose parser choked (truncation), or a name with no declared/legacy
    // custom status. Both look identical to a genuine empty call afterward,
    // so log here — this is the last point where the raw text still exists.
    const why = declaredCustom === false ? "declared as a function, arguments must be JSON" : "not a declared custom/apply_patch tool";
    console.warn(`[Translator] Non-JSON tool call arguments for "${toolName || "(unnamed)"}" coerced to "{}" — ${why}`);
    return "{}";
  }
}

// function_call_output.output must be a string — never null/object.
export function coerceResponsesOutput(value) {
  if (isString(value)) return value;
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value.map((c) => {
      try {
        return c?.text ?? JSON.stringify(c);
      } catch {
        return String(c);
      }
    }).join("");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Native Responses clients skip translation (sourceFormat === targetFormat), so a
// prior-turn `reasoning` item's encrypted_content can reach an executor unvalidated
// by this caller's account. OpenCode's pooled/rotated credentials reject it with
// 400 "reasoning encrypted_content was not issued to this caller" (port of
// decolua/9router eafac37d). Callers filter `body.input` with this predicate after
// guarding for non-object/array items; it returns false to drop a reasoning item
// outright and mutates any surviving item to scrub a stray encrypted field.
export function stripPriorReasoningItem(item) {
  if (item.type === "reasoning") return false;
  delete item.encrypted_content;
  delete item.reasoning_encrypted_content;
  return true;
}

/**
 * Repair Responses API items whose `call_id` correlation key is missing.
 *
 * Clients that drop `call_id` when building `function_call` / `function_call_output`
 * items (Droid, OpenCode, and other agent CLIs have been observed doing this) make
 * the translator serialize a chat tool message as `tool_call_id: undefined`, a key
 * `JSON.stringify` silently removes. Strict upstreams then reject the WHOLE request
 * with 400 "missing field `tool_call_id`" (NVIDIA NIM and several OpenAI-compatible
 * gateways) — one malformed item kills every model in a combo.
 *
 * Mints a deterministic id for a call missing one, and pairs an id-less output with
 * the oldest still-unanswered call, in order. Items needing no change are returned
 * by reference; only touched items are cloned.
 *
 * @param {unknown} items Normalized Responses API input array.
 * @returns {unknown} Repaired array, or the original reference when nothing changed.
 */
export function repairMissingResponsesCallIds(items) {
  if (!Array.isArray(items)) return items;

  const pendingCallIds = [];
  let changed = false;

  const repaired = items.map((item) => {
    if (!item || !isObject(item)) return item;

    if (item.type === RESPONSES_ITEM.FUNCTION_CALL) {
      if (!isString(item.name) || item.name.trim() === "") return item;
      if (isString(item.call_id) && item.call_id) {
        pendingCallIds.push(item.call_id);
        return item;
      }
      changed = true;
      const callId = clampResponsesCallId(undefined);
      pendingCallIds.push(callId);
      return { ...item, call_id: callId };
    }

    if (item.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) {
      if (isString(item.call_id) && item.call_id) {
        const queued = pendingCallIds.indexOf(item.call_id);
        if (queued >= 0) pendingCallIds.splice(queued, 1);
        return item;
      }
      const repairedId = pendingCallIds.shift();
      if (!repairedId) return item; // genuine orphan — no pending call to answer
      changed = true;
      return { ...item, call_id: repairedId };
    }

    return item;
  });

  return changed ? repaired : items;
}

/**
 * Convert OpenAI Responses API format to standard chat completions format
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 */
export function convertResponsesApiFormat(body) {
  if (!body.input) return body;

  const result = { ...body };
  result.messages = [];

  // Convert instructions to system message
  if (body.instructions) {
    result.messages.push({ role: ROLE.SYSTEM, content: body.instructions });
  }

  // Group items by conversation turn
  let currentAssistantMsg = null;
  let pendingToolResults = [];

  const inputItems = repairMissingResponsesCallIds(normalizeResponsesInput(body.input));
  if (!inputItems) return body;

  for (const item of inputItems) {
    // Determine item type - Droid CLI sends role-based items without 'type' field
    // Fallback: if no type but has role property, treat as message
    const itemType = item.type || (item.role ? RESPONSES_ITEM.MESSAGE : null);

    if (itemType === RESPONSES_ITEM.MESSAGE) {
      // Flush any pending assistant message with tool calls
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Flush pending tool results
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }

      // Convert content: input_text → text, output_text → text, input_image → image_url
      const content = Array.isArray(item.content) ?
      item.content.map((c) => {
        if (c.type === RESPONSES_ITEM.INPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
        if (c.type === RESPONSES_ITEM.OUTPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
        if (c.type === RESPONSES_ITEM.INPUT_IMAGE) {
          const url = c.image_url || c.file_id || "";
          return { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url, detail: c.detail || "auto" } };
        }
        return c;
      }) :
      item.content;
      result.messages.push({ role: item.role, content });
    } else
    if (itemType === RESPONSES_ITEM.FUNCTION_CALL) {
      // Start or append to assistant message with tool_calls
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: ROLE.ASSISTANT,
          content: null,
          tool_calls: []
        };
      }
      // Skip items with empty/missing name — upstream APIs reject nameless tool calls (#444)
      if (!item.name || !isString(item.name) || item.name.trim() === "") continue;
      currentAssistantMsg.tool_calls.push({
        id: item.call_id,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: item.name,
          arguments: item.arguments
        }
      });
    } else
    if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) {
      // Flush assistant message first if exists
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Add tool result — repairMissingResponsesCallIds above already paired a
      // dropped call_id with the oldest pending call; a still-missing id here is
      // a genuine orphan (no call to answer) and is dropped rather than emitting
      // an unpairable tool message.
      if (item.call_id) {
        pendingToolResults.push({
          role: ROLE.TOOL,
          tool_call_id: item.call_id,
          content: isString(item.output) ? item.output : JSON.stringify(item.output)
        });
      }
    } else
    if (itemType === RESPONSES_ITEM.REASONING) {
      // Skip reasoning items - they are for display only
      continue;
    }
  }

  // Flush remaining
  if (currentAssistantMsg) {
    result.messages.push(currentAssistantMsg);
  }
  if (pendingToolResults.length > 0) {
    for (const tr of pendingToolResults) {
      result.messages.push(tr);
    }
  }

  // Cleanup Responses API specific fields
  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.store;
  delete result.reasoning;

  return result;
}