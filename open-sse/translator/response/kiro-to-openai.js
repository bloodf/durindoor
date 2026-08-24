/**
 * Kiro to OpenAI Response Translator
 * Converts Kiro/AWS CodeWhisperer streaming events to OpenAI SSE format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";

// Build chunk meta for current kiro state
import { isObject, isString } from "@/shared/utils/typeChecks.js";function chunkMeta(state) {
  return { id: state.responseId, created: state.created, model: state.model || "kiro" };
}

/**
 * Map sanitized tool names back to the names the client registered.
 *
 * Kiro rejects consecutive underscores, so openai-to-kiro collapses them and
 * records the original in `state.toolNameMap`. Returns the chunk untouched
 * when there is no map or nothing in it matches, so the common no-tool case
 * allocates nothing.
 */
function restoreToolNames(chunk, state) {
  const map = state?.toolNameMap;
  if (!map || map.size === 0) return chunk;
  let changed = false;
  const choices = chunk.choices.map((choice) => {
    const calls = choice?.delta?.tool_calls;
    if (!Array.isArray(calls)) return choice;
    let choiceChanged = false;
    const mapped = calls.map((call) => {
      const original = call?.function?.name ? map.get(call.function.name) : undefined;
      if (!original || original === call.function.name) return call;
      choiceChanged = true;
      return { ...call, function: { ...call.function, name: original } };
    });
    if (!choiceChanged) return choice;
    changed = true;
    return { ...choice, delta: { ...choice.delta, tool_calls: mapped } };
  });
  return changed ? { ...chunk, choices } : chunk;
}

/**
 * Parse Kiro SSE event and convert to OpenAI format
 * Kiro events: assistantResponseEvent, codeEvent, supplementaryWebLinksEvent, etc.
 */
export function kiroToOpenAIResponse(chunk, state) {

  if (!chunk) return null;

  // If chunk is already in OpenAI format (from executor transform), return as-is.
  // Provider-only metering fields (Kiro credits) are internal: strip them from
  // the client-facing usage so strict OpenAI-schema clients never see them.
  // Internal accounting is unaffected — stream.js extracted raw usage into
  // state before translation.
  if (chunk.object === "chat.completion.chunk" && chunk.choices) {
    // The Kiro executor converts the binary EventStream to OpenAI chunks
    // itself, so a live tool call reaches here already shaped and carrying the
    // sanitized name. This is the only seam that sees those chunks -- the raw
    // toolUseEvent branch below never runs on the live path.
    const restored = restoreToolNames(chunk, state);
    if (restored.usage && (restored.usage.kiro_credits !== undefined || restored.usage.kiro_credit_unit !== undefined)) {
      const { kiro_credits, kiro_credit_unit, ...usage } = restored.usage;
      // If stripping Kiro-only fields leaves a zero-field object, omit usage
      // entirely so OpenAI clients do not receive a present-but-empty usage
      // object on the finish chunk.
      if (Object.keys(usage).length === 0) {
        const stripped = { ...restored };
        delete stripped.usage;
        return stripped;
      }
      return { ...restored, usage };
    }
    return restored;
  }

  // Handle string chunk (raw SSE data)
  let data = chunk;
  if (isString(chunk)) {
    // Parse SSE format: event:xxx\ndata:xxx
    const lines = chunk.split("\n");
    let eventType = "";
    let eventData = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith(":event-type:")) {
        eventType = line.slice(12).trim();
      } else if (line.startsWith("data:")) {
        eventData = line.slice(5).trim();
      } else if (line.startsWith(":content-type:")) {

        // Skip content-type header
      } else if (line.trim() && !line.startsWith(":")) {// Raw JSON data
        eventData = line.trim();
      }
    }

    if (!eventData) return null;

    try {
      data = JSON.parse(eventData);
      data._eventType = eventType;
    } catch {
      // Not JSON, might be raw text
      data = { text: eventData, _eventType: eventType };
    }
  }

  // Initialize state if needed
  if (!state.responseId) {
    state.responseId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.chunkIndex = 0;
  }

  const eventType = data._eventType || data.event || "";

  // Handle different Kiro event types
  if (eventType === "assistantResponseEvent" || data.assistantResponseEvent) {
    const content = data.assistantResponseEvent?.content || data.content || "";
    if (!content) return null;

    const openaiChunk = buildChunk(chunkMeta(state), {
      ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : null),
      content: content
    }, null);

    state.chunkIndex++;
    return openaiChunk;
  }

  // Handle reasoning/thinking events.
  // Kiro emits reasoningContentEvent when the request enabled thinking via
  // the <thinking_mode>enabled</thinking_mode> system-prompt tag. We surface
  // this as OpenAI delta.reasoning_content so downstream translators can map
  // it to Claude thinking blocks / Anthropic reasoning / etc.
  if (eventType === "reasoningContentEvent" || data.reasoningContentEvent) {
    const reasoning = data.reasoningContentEvent || data;
    const content = isString(reasoning) ?
    reasoning :
    reasoning.text || reasoning.content || data.content || "";
    if (!content) return null;

    const openaiChunk = buildChunk(chunkMeta(state), reasoningDelta(content, state.chunkIndex === 0), null);

    state.chunkIndex++;
    return openaiChunk;
  }

  // Handle tool use events
  if (eventType === "toolUseEvent" || data.toolUseEvent) {
    state.hadToolUse = true;
    const toolUse = data.toolUseEvent || data;
    const toolCallId = toolUse.toolUseId || fallbackToolCallId();
    // Kiro echoes back the sanitized name; hand the client the name it sent.
    const sanitized = toolUse.name || "";
    const toolName = state?.toolNameMap?.get(sanitized) ?? sanitized;
    const toolInput = toolUse.input || {};

    // Each toolUseEvent in a turn must carry a unique index so downstream
    // translators (openai-to-claude) can keep distinct open tool blocks per call.
    state.toolCallIndex = state.toolCallIndex ?? 0;
    const idx = state.toolCallIndex;
    state.toolCallIndex = idx + 1;

    const openaiChunk = buildChunk(chunkMeta(state), {
      ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : null),
      tool_calls: [{
        index: idx,
        id: toolCallId,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: toolName,
          arguments: JSON.stringify(toolInput)
        }
      }]
    }, null);

    state.chunkIndex++;
    return openaiChunk;
  }

  // Handle completion/done events
  if (eventType === "messageStopEvent" || eventType === "done" || data.messageStopEvent) {
    // tool_calls when a tool was used this turn, else stop (kiro upstream has no explicit reason)
    const finishReason = toOpenAIFinish(state.hadToolUse ? "tool_use" : "stop", "kiro");
    state.finishReason = finishReason; // Mark for usage injection in stream.js

    const openaiChunk = buildChunk(chunkMeta(state), {}, finishReason);

    // Include usage in final chunk if available
    if (state.usage && isObject(state.usage)) {
      openaiChunk.usage = state.usage;
    }

    return openaiChunk;
  }

  // Handle usage events
  if (eventType === "usageEvent" || data.usageEvent) {
    const usage = toOpenAIUsage(data.usageEvent || data, "kiro");
    if (usage) state.usage = usage;
    return null;
  }

  // Unknown event type - skip
  return null;
}

// Register translator
register(FORMATS.KIRO, FORMATS.OPENAI, null, kiroToOpenAIResponse);