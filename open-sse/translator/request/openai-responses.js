/**
 * Translator: OpenAI Responses API → OpenAI Chat Completions
 * 
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import {
  normalizeResponsesInput,
  clampResponsesCallId,
  coerceResponsesArguments,
  coerceResponsesOutput,
  repairMissingResponsesCallIds,
  buildDeclaredToolTypes,
  resolveDeclaredCustom,
} from "../formats/responsesApi.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM, VALID_OPENAI_CONTENT_TYPES } from "../schema/index.js";
import { collapseTextParts } from "../concerns/message.js";

import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
// Responses API enforces max 64 chars on call_id (#393) — clamping lives in
// clampResponsesCallId (formats/responsesApi.js), standardized upstream in #3819.

/**
 * Scan a Responses API `input[]` and collect every `call_id` declared by a
 * `function_call` item. Returns a Set (possibly empty) of known call ids.
 *
 * Only `function_call` items introduce a tool call a downstream provider can
 * match a result against; other item types are ignored.
 */
function collectKnownCallIds(input) {
  const knownCallIds = new Set();
  for (const item of input) {
    if (item?.type === RESPONSES_ITEM.FUNCTION_CALL && isString(item.call_id)) {
      knownCallIds.add(item.call_id);
    }
  }
  return knownCallIds;
}

/**
 * Remove `function_call_output` items that reference a `call_id` with no
 * matching `function_call` in the same `input[]`.
 *
 * Clients that truncate or summarize conversation history (e.g. Codex CLI,
 * some agents) can drop the assistant turn containing the tool call while
 * keeping the subsequent tool result. The Responses API then rejects the
 * whole request with HTTP 400:
 *
 *   "No tool call found for function call output with call_id X"
 *
 * This is input validation only: it rewrites request payloads before they
 * leave the translator, regardless of provider or entry path.
 *
 * Returns the original array reference when nothing needs to change (non-array
 * input, no tool output items, or every output already has a matching call),
 * so callers can cheaply avoid cloning large inputs.
 */
function stripOrphanedToolOutputs(input) {
  if (!Array.isArray(input)) return input;
  const knownCallIds = collectKnownCallIds(input);

  const stripped = [];
  const deduped = input.filter((item) => {
    if (item?.type !== RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) return true;
    const hasMatch = isString(item.call_id) && knownCallIds.has(item.call_id);
    if (!hasMatch) {
      console.warn(`[Translator] Stripped orphaned function_call_output (call_id=${item.call_id}) — no matching function_call in input`);
      stripped.push(item.call_id);
    }
    return hasMatch;
  });
  return stripped.length === 0 ? input : deduped;
}
const MAX_TOOL_NAME_LEN = 128;

/**
 * Convert OpenAI Responses API request to OpenAI Chat Completions format
 */
/** `{ name, namespace }` -> the expanded `{namespace}.{name}` declaration name. */
function qualifyNamespacedName({ name, namespace }) {
  if (!isString(name) || !isString(namespace) || !namespace || name.startsWith(`${namespace}.`)) return name;
  return `${namespace}.${name}`;
}

function qualifyNamespacedChoice(choice) {
  const qualify = (entry) => {
    if (!entry || !isObject(entry) || !isString(entry.namespace)) return entry;
    const { namespace, ...rest } = entry;
    return { ...rest, name: qualifyNamespacedName({ name: entry.name, namespace }) };
  };
  const qualified = qualify(choice);
  return Array.isArray(qualified.tools) ? { ...qualified, tools: qualified.tools.map(qualify) } : qualified;
}

export function openaiResponsesToOpenAIRequest(model, body, stream, credentials) {
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
  let pendingReasoning = "";
  // call_ids skipped at FUNCTION_CALL time (nameless, #444) never get a
  // tool_calls entry. Their function_call_output must be dropped too, or the
  // "tool" message that follows references a tool_call_id that does not
  // exist in the assistant turn — OpenAI-shaped APIs reject that pairing.
  const skippedCallIds = new Set();

  // A blank content value carries no text worth keeping: null/undefined, an
  // empty or whitespace-only string, or a part array that is empty or holds
  // only whitespace-only text parts (Responses text always arrives as a part
  // array, e.g. `[{type:"output_text", text:""}]`, never a bare "").
  const isBlankContent = (content) => {
    if (content == null) return true;
    if (isString(content)) return content.trim() === "";
    if (Array.isArray(content)) {
      return content.every((part) => part?.type === OPENAI_BLOCK.TEXT && !(part.text || "").trim());
    }
    return false;
  };

  // Responses can split visible assistant text across more than one
  // `message` item on the same turn (e.g. text, then a tool call, then more
  // text). Append instead of keeping only the first non-null content.
  const appendAssistantContent = (msg, content) => {
    // A blank incoming content carries nothing to add — appending it as a
    // blank text part would join into a stray leading/trailing "\n".
    if (isBlankContent(content)) return;
    // A blank existing content (including a part array of all-empty text
    // parts) has nothing to preserve — replace it outright rather than
    // wrapping it as a blank text part and joining.
    if (isBlankContent(msg.content)) {
      msg.content = content;
      return;
    }
    const existing = Array.isArray(msg.content) ? msg.content : [{ type: OPENAI_BLOCK.TEXT, text: msg.content }];
    const incoming = Array.isArray(content) ? content : [{ type: OPENAI_BLOCK.TEXT, text: content }];
    msg.content = [...existing, ...incoming];
  };

  // Repair items whose `call_id` was dropped by the client BEFORE the orphan
  // strip below: pairing an id-less function_call_output with the oldest
  // unanswered function_call keeps a legitimate tool result instead of the
  // strip pass discarding it as an orphan.
  const inputItems = stripOrphanedToolOutputs(repairMissingResponsesCallIds(normalizeResponsesInput(body.input)));
  if (!inputItems) return body;

  // Declared tool types (custom vs function) on this request, hoisted above
  // the item loop below so coerceResponsesArguments can tell a custom tool's
  // raw body apart from an ordinary function's malformed JSON, and never
  // freeform-wrap a name like "apply_patch" that this request declares as an
  // ordinary function (upstream #4208 review, round 2).
  const declaredToolTypes = buildDeclaredToolTypes(body.tools);

  // Extract reasoning text from summary[].text or encrypted_content fallback
  const extractReasoningText = (item) => {
    if (Array.isArray(item.summary)) {
      const txt = item.summary.map((s) => s?.text || "").filter(Boolean).join("\n");
      if (txt) return txt;
    }
    if (Array.isArray(item.content)) {
      const txt = item.content.map((c) => c?.text || "").filter(Boolean).join("\n");
      if (txt) return txt;
    }
    return "";
  };

  // Responses splits one assistant turn into a message item plus separate
  // function_call items; Chat Completions models that as a SINGLE assistant
  // message carrying content + tool_calls + reasoning_content. Emitting them as
  // two consecutive assistant messages makes thinking-mode upstreams reject the
  // whole request as soon as tools are declared. Reasoning is attached at flush
  // time (not at creation) so a reasoning item that arrives after the message
  // item — Codex emits the message first — still lands on the turn it belongs to.
  const flushAssistant = () => {
    if (!currentAssistantMsg) return;
    if (pendingReasoning) {
      currentAssistantMsg.reasoning_content = pendingReasoning;
      pendingReasoning = "";
    }
    if (!currentAssistantMsg.tool_calls?.length) delete currentAssistantMsg.tool_calls;
    // A text-only content array (no tool calls survived, or every call was
    // nameless) must ship as a string. filterToOpenAIFormat only collapses
    // array content (and drops non-whitelisted parts like refusal/input_file)
    // for messages WITHOUT tool_calls, and a real tool_calls array skips that
    // pass entirely, so both steps run here instead.
    if (Array.isArray(currentAssistantMsg.content)) {
      const whitelisted = currentAssistantMsg.content.filter((part) => VALID_OPENAI_CONTENT_TYPES.includes(part?.type));
      currentAssistantMsg.content = collapseTextParts(whitelisted);
      // collapseTextParts([]) returns [] as-is (its guard requires length > 0),
      // so an empty-after-filter array survives as `{content:[]}` next to
      // tool_calls. Normalize it to null here so the check below treats it
      // the same as a turn that never got any content.
      if (Array.isArray(currentAssistantMsg.content) && currentAssistantMsg.content.length === 0) {
        currentAssistantMsg.content = null;
      }
    }
    // A turn whose tool calls were all skipped (nameless, #444) is left with no
    // content and no tool_calls. Pushing it would send `{role:"assistant",
    // content:null}`, which OpenAI-shaped APIs reject just like the empty
    // tool_calls array this replaces. Keep it only if reasoning still rides on it,
    // and normalize content to "" in that case, since content:null is still rejected.
    if (currentAssistantMsg.content == null && !currentAssistantMsg.tool_calls) {
      if (!currentAssistantMsg.reasoning_content) {
        currentAssistantMsg = null;
        return;
      }
      currentAssistantMsg.content = "";
    }
    result.messages.push(currentAssistantMsg);
    currentAssistantMsg = null;
  };

  for (const item of inputItems) {
    // Determine item type - Droid CLI sends role-based items without 'type' field
    // Fallback: if no type but has role property, treat as message
    const itemType = item.type || (item.role ? RESPONSES_ITEM.MESSAGE : null);

    if (itemType === RESPONSES_ITEM.MESSAGE) {
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

      // Assistant content joins the pending turn instead of starting a second
      // assistant message (see flushAssistant above).
      if (item.role === ROLE.ASSISTANT) {
        if (currentAssistantMsg) {
          appendAssistantContent(currentAssistantMsg, content);
        } else {
          currentAssistantMsg = { role: ROLE.ASSISTANT, content, tool_calls: [] };
        }
        continue;
      }

      // Flush any pending assistant message with tool calls
      flushAssistant();
      // Flush pending tool results
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }
      pendingReasoning = "";
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
      // Skip items with empty/missing name — Codex/OpenAI reject nameless tool calls (#444)
      if (!item.name || !isString(item.name) || item.name.trim() === "") {
        // A live tool_calls entry already claims this call_id (an earlier
        // NAMED call used it) — that call is real, so its output must still
        // ship. Only mark the id skipped when nothing real answers it.
        const hasLiveToolCall = currentAssistantMsg.tool_calls?.some((tc) => tc.id === item.call_id);
        if (isString(item.call_id) && !hasLiveToolCall) skippedCallIds.add(item.call_id);
        continue;
      }
      // A named call reusing a call_id an earlier nameless call skipped is a
      // real tool call now — un-skip the id so its function_call_output is
      // not dropped as if it still answered the discarded call.
      skippedCallIds.delete(item.call_id);
      // Replayed namespace calls carry `{ name, namespace }`; re-qualify them so history
      // matches the expanded `{namespace}.{subtool}` declaration (and its alias).
      // Qualify first so both the pushed name AND the declaration lookup use
      // the same dotted `{namespace}.{subtool}` name (#940 + #4208 review,
      // round 6) — otherwise a namespaced custom tool's declaration (keyed on
      // the qualified name in declaredToolTypes) would miss on the bare name.
      const qualifiedName = qualifyNamespacedName(item);
      currentAssistantMsg.tool_calls.push({
        id: item.call_id,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: qualifiedName,
          // Codex replays raw streamed args verbatim; non-JSON strings (partial
          // fragments / freeform text) must be coerced or upstream rejects the
          // chat/completions body with "function.arguments must be valid JSON".
          // A declared custom tool's raw body is preserved as JSON instead of
          // dropped, and a name this request declares as a function (even
          // "apply_patch") is never freeform-wrapped (declaredToolTypes above).
          arguments: coerceResponsesArguments(item.arguments, qualifiedName, resolveDeclaredCustom(declaredToolTypes, qualifiedName))
        }
      });
    } else
    if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) {
      // Flush assistant message first (if any) BEFORE the skip check below —
      // a skipped output must still close out the turn it belongs to, or the
      // next assistant message merges onto this one across the turn boundary
      // that its (dropped) function_call_output was supposed to mark.
      flushAssistant();
      // The call this output answers was skipped (nameless, #444) and never
      // became a tool_calls entry — drop the output too rather than emit an
      // orphaned "tool" message with no matching tool_call_id.
      if (skippedCallIds.has(item.call_id)) continue;
      // Flush any pending tool results first
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }
      // Add tool result immediately
      result.messages.push({
        role: ROLE.TOOL,
        tool_call_id: item.call_id,
        content: isString(item.output) ? item.output : JSON.stringify(item.output)
      });
    } else
    if (itemType === RESPONSES_ITEM.REASONING) {
      // Buffer reasoning text; attached to next assistant message/function_call
      const txt = extractReasoningText(item);
      if (txt) pendingReasoning = pendingReasoning ? `${pendingReasoning}\n${txt}` : txt;
      continue;
    }
  }

  // Flush remaining
  flushAssistant();
  if (pendingToolResults.length > 0) {
    for (const tr of pendingToolResults) {
      result.messages.push(tr);
    }
  }

  // Convert tools format.
  // Responses API supports "hosted" tools (e.g. { type: "request_user_input" }) that carry no
  // explicit `name` field and cannot be represented as Chat Completions function declarations.
  // Filter them out to avoid sending nameless functionDeclarations to downstream providers
  // such as Gemini, which strictly validates function names.
  /**
   * Preserve custom-tool identity across Chat Completions lowering so buffered
   * response routes can restore Responses semantics (upstream PR #3373).
   * (declaredToolTypes collected earlier, above the item loop.)
   */
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools.
    flatMap((tool) => {
      // Already in Chat Completions format: { type: "function", function: { name, ... } }
      if (tool.function) return tool;
      // Responses namespace tools have no Chat equivalent. Expand each declared
      // subtool; response state keeps the namespace for the reverse projection.
      // Dotted names stay dotted here: translateRequest aliases the OpenAI intermediate
      // for every target, and the response side restores via toolNameMap.
      if (tool.type === "namespace" && Array.isArray(tool.tools)) {
        const namespace = isString(tool.name) ? tool.name : "";
        return tool.tools.
        filter((subtool) => isString(subtool?.name) && subtool.name.trim() !== "").
        map((subtool) => ({
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: namespace ? `${namespace}.${subtool.name}` : subtool.name,
            description: String(subtool.description || tool.description || ""),
            parameters: normalizeToolParameters(subtool.parameters),
            strict: subtool.strict
          }
        }));
      }
      // Responses API custom (freeform) tool: { type: "custom", name, description }.
      // Chat Completions has no custom-tool type, so normalize it to a function
      // tool whose single parameter is the raw `input` string. The response
      // translator re-emits it as a custom_tool_call by name (OmniRoute #7905).
      if (tool.type === "custom" && isString(tool.name) && tool.name.trim() !== "") {
        return {
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: tool.name,
            description: String(tool.description || ""),
            parameters: {
              type: "object",
              properties: { input: { type: "string" } },
              required: ["input"],
              additionalProperties: false
            },
            strict: tool.strict
          }
        };
      }
      // Responses API function tool: { type: "function", name, description, parameters }
      // Only convert when a non-empty name is present; skip hosted tools without one.
      const name = tool.name;
      if (!name || !isString(name) || name.trim() === "") return null;
      return {
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name,
          description: String(tool.description || ""),
          parameters: normalizeToolParameters(tool.parameters),
          strict: tool.strict
        }
      };
    }).
    filter(Boolean);
  }
  const customToolNames = [...declaredToolTypes].filter(([, type]) => type === "custom").map(([name]) => name);
  if (customToolNames.length > 0) result._customToolNames = customToolNames;

  // Cleanup Responses API specific fields
  // Map Responses-only max_output_tokens to Chat max_tokens (avoid leaking unknown field upstream)
  if (result.max_output_tokens !== undefined) {
    if (result.max_tokens === undefined) result.max_tokens = result.max_output_tokens;
    delete result.max_output_tokens;
  }


  if (result.tool_choice && isObject(result.tool_choice)) {
    result.tool_choice = qualifyNamespacedChoice(result.tool_choice);
  }

  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.store;
  delete result.reasoning;
  // OpenAI-specific Responses API fields not supported by third-party providers (#2311)
  delete result.client_metadata;
  delete result.background;
  delete result.truncation;

  return result;
}

/**
 * Extract plain text from a system/developer message for Responses instructions.
 * Array content (text parts) is joined; anything else falls back to "" rather
 * than leaking "[object Object]" upstream.
 */
function extractInstructionsText(content) {
  if (isString(content)) return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (isString(c?.text)) return c.text;
      if (isString(c?.content)) return c.content;
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

/**
 * Ensure object schema always has properties field (required by Codex Responses API)
 */
function normalizeToolParameters(params) {
  if (!params) return { type: "object", properties: {} };
  if (params.type === "object" && !params.properties) return { ...params, properties: {} };
  return params;
}

/**
 * Normalize Chat Completions output limits at the shared Responses wire seam.
 * Native max_output_tokens wins when both fields are present.
 */
function normalizeResponsesOutputLimit(source, target) {
  if (target.max_output_tokens === undefined) {
    if (source.max_output_tokens !== undefined) target.max_output_tokens = source.max_output_tokens;else
    if (source.max_tokens !== undefined) target.max_output_tokens = source.max_tokens;
  }
  delete target.max_tokens;
  return target;
}

/**
 * Convert OpenAI Chat Completions to OpenAI Responses API format.
 * Generic Responses transports preserve the caller's stream mode here so
 * non-streaming clients can receive JSON from native /responses endpoints.
 * Callers that always parse /responses as SSE, such as GitHub escalation,
 * must pass stream=true explicitly.
 */
export function openaiToOpenAIResponsesRequest(model, body, stream, credentials) {
  if (body.input) {
    const cleanInput = stripOrphanedToolOutputs(body.input);
    const result = cleanInput === body.input ? { ...body, model, stream } : { ...body, input: cleanInput, model, stream };
    return normalizeResponsesOutputLimit(body, result);
  }

  const result = {
    model,
    input: [],
    stream,
    store: false
  };

  // Extract system message as instructions
  let hasSystemMessage = false;
  const messages = body.messages || [];

  // Declared tool types on this Chat Completions body, hoisted above the
  // message loop so coerceResponsesArguments never freeform-wraps a name
  // this request declares as an ordinary function (upstream #4208 review,
  // round 2). Chat Completions tools are always type "function"; there is
  // no "custom" shape on this path, but a declared "apply_patch" function
  // must still win over the legacy name fallback.
  const declaredToolTypes = buildDeclaredToolTypes(body.tools);

  for (const msg of messages) {
    if (msg.role === ROLE.SYSTEM || msg.role === ROLE.DEVELOPER) {
      // Use the first instruction-bearing message as instructions.
      // OpenAI recommends role="developer" for GPT-5/Codex as the system-level prompt.
      if (!hasSystemMessage) {
        result.instructions = extractInstructionsText(msg.content);
        hasSystemMessage = true;
      }
      continue; // Skip instruction messages in input
    }

    // Convert user/assistant messages to input items
    if (msg.role === ROLE.USER || msg.role === ROLE.ASSISTANT) {
      // Preserve reasoning_content as a reasoning item (before the message)
      if (msg.role === ROLE.ASSISTANT && msg.reasoning_content) {
        result.input.push({
          type: RESPONSES_ITEM.REASONING,
          summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: msg.reasoning_content }]
        });
      }

      const contentType = msg.role === ROLE.USER ? RESPONSES_ITEM.INPUT_TEXT : RESPONSES_ITEM.OUTPUT_TEXT;
      const content = isString(msg.content) ?
      [{ type: contentType, text: msg.content }] :
      Array.isArray(msg.content) ?
      msg.content.map((c) => {
        if (c.type === OPENAI_BLOCK.TEXT) return { type: contentType, text: c.text };
        // Convert Chat Completions image_url → Responses API input_image
        // Responses API expects: { type: "input_image", image_url: "<url string>" }
        // Chat Completions sends: { type: "image_url", image_url: { url: "...", detail: "..." } }
        if (c.type === OPENAI_BLOCK.IMAGE_URL) {
          const url = isString(c.image_url) ? c.image_url : c.image_url?.url;
          return { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: url, detail: c.image_url?.detail || "auto" };
        }
        if (c.type === RESPONSES_ITEM.INPUT_IMAGE) return c;
        // Serialize any unknown type (tool_use, tool_result, thinking, etc.) as text
        const text = c.text || c.content || JSON.stringify(c);
        return { type: contentType, text: isString(text) ? text : JSON.stringify(text) };
      }) :
      [];

      // Only push a message block if content is non-empty.
      // Assistant messages with only tool_calls have content: null — skip the
      // message block in that case; the tool_calls are pushed separately below.
      if (content.length > 0) {
        result.input.push({
          type: RESPONSES_ITEM.MESSAGE,
          role: msg.role,
          content
        });
      }
    }

    // Convert tool calls
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        // Skip nameless calls — strict Responses upstreams reject them (#444)
        const name = isString(tc.function?.name) ? tc.function.name.trim() : "";
        if (!name) continue;
        result.input.push({
          type: RESPONSES_ITEM.FUNCTION_CALL,
          call_id: clampResponsesCallId(tc.id),
          name: name.slice(0, MAX_TOOL_NAME_LEN),
          arguments: coerceResponsesArguments(tc.function?.arguments, name, resolveDeclaredCustom(declaredToolTypes, name))
        });
      }
    }

    // Convert tool results - output must be a string for Responses API
    if (msg.role === ROLE.TOOL) {
      result.input.push({
        type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
        call_id: clampResponsesCallId(msg.tool_call_id),
        output: coerceResponsesOutput(msg.content)
      });
    }
  }

  // If no system message, leave instructions empty (will be filled by executor)
  if (!hasSystemMessage) {
    result.instructions = "";
  }

  // Convert tools format
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools.map((tool) => {
      if (tool.type === OPENAI_BLOCK.FUNCTION) {
        // Strict upstreams reject nameless/overlong tool declarations
        const name = isString(tool.function?.name) ? tool.function.name.trim() : "";
        if (!name) return null;
        return {
          type: OPENAI_BLOCK.FUNCTION,
          name: name.slice(0, MAX_TOOL_NAME_LEN),
          description: String(tool.function.description || ""),
          parameters: normalizeToolParameters(tool.function.parameters),
          // The Responses API requires `strict` on every function tool; default to
          // false (non-strict) instead of forwarding an undefined field.
          strict: tool.function.strict ?? false
        };
      }
      return tool;
    }).filter(Boolean);
  }

  if (body.temperature !== undefined) result.temperature = body.temperature;
  normalizeResponsesOutputLimit(body, result);
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.reasoning !== undefined) result.reasoning = body.reasoning;
  if (body.reasoning_effort !== undefined) result.reasoning = { effort: body.reasoning_effort, summary: "auto" };
  if (body.service_tier !== undefined) result.service_tier = body.service_tier;
  if (body.prompt_cache_key !== undefined) result.prompt_cache_key = body.prompt_cache_key;

  result.input = stripOrphanedToolOutputs(result.input);

  return result;
}

// Register both directions
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, openaiResponsesToOpenAIRequest, null);
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, openaiToOpenAIResponsesRequest, null);