import { isString } from "../../../src/shared/utils/typeChecks.js";
import { createDsmlStreamState, isDeepSeekFamilyModel, parseDsmlToolCalls } from "../../utils/dsmlToolCalls.js";
import { fallbackToolCallId } from "./toolCall.js";
import { CLAUDE_STOP, OPENAI_FINISH } from "../schema/finishReasons.js";
import { CLAUDE_BLOCK, OPENAI_BLOCK } from "../schema/blocks.js";
function wireCall(call, index) {
  return { index, id: fallbackToolCallId(index), type: OPENAI_BLOCK.FUNCTION, function: { name: call.name, arguments: JSON.stringify(call.arguments) } };
}
/** Normalize OpenAI-shaped deltas, preserving choice and structured-call indices. */
export function normalizeDsmlChunks(chunks, state) {
  if (!state || !isDeepSeekFamilyModel(state.dsmlModel ?? state.model, state.provider)) return chunks;
  state.dsmlChoices ??= new Map();
  const output = [];
  for (const chunk of chunks) {
    if (!chunk) {
      for (const [index, entry] of state.dsmlChoices) {
        const tail = entry.parser.flush();
        entry.calls.push(...tail.toolCalls);
        if (tail.text || entry.calls.length) {
          const delta = {};
          if (tail.text) delta.content = tail.text;
          if (entry.calls.length) delta.tool_calls = entry.calls.map((call) => wireCall(call, ++entry.maxIndex));
          output.push({ ...entry.template, choices: [{ index, delta, finish_reason: null }] });
        }
        entry.calls = [];
      }
      output.push(chunk);
      continue;
    }
    if (!Array.isArray(chunk.choices) || !chunk.choices.length) { output.push(chunk); continue; }
    for (const [position, choice] of chunk.choices.entries()) {
      const index = choice.index ?? position;
      let entry = state.dsmlChoices.get(index);
      if (!entry) { entry = { parser: createDsmlStreamState(), calls: [], maxIndex: -1 }; state.dsmlChoices.set(index, entry); }
      entry.template = chunk;
      const delta = { ...choice.delta };
      for (const call of delta.tool_calls || []) if (Number.isInteger(call.index)) entry.maxIndex = Math.max(entry.maxIndex, call.index);
      if (isString(delta.content)) {
        const result = entry.parser.push(delta.content);
        entry.calls.push(...result.toolCalls);
        if (result.text) delta.content = result.text; else delete delta.content;
      }
      if (choice.finish_reason) {
        const result = entry.parser.flush();
        entry.calls.push(...result.toolCalls);
        if (result.text) delta.content = (delta.content || "") + result.text;
        if (entry.calls.length) {
          delta.tool_calls = [...(delta.tool_calls || []), ...entry.calls.map((call) => wireCall(call, ++entry.maxIndex))];
          entry.calls = [];
          entry.extracted = true;
        }
      }
      const finish = choice.finish_reason === OPENAI_FINISH.STOP && entry.extracted ? OPENAI_FINISH.TOOL_CALLS : choice.finish_reason;
      if (Object.keys(delta).length || finish || chunk.usage) output.push({ ...chunk, choices: [{ ...choice, delta, finish_reason: finish }] });
    }
  }
  return output;
}
export function normalizeDsmlCompletion(response, model, provider) {
  if (!isDeepSeekFamilyModel(model, provider)) return response;
  for (const choice of response?.choices || []) {
    const message = choice?.message;
    if (!isString(message?.content)) continue;
    const parsed = parseDsmlToolCalls(message.content);
    if (!parsed.toolCalls.length) continue;
    const existing = message.tool_calls || [];
    message.content = parsed.content || null;
    message.tool_calls = [...existing, ...parsed.toolCalls.map((call, i) => { const { index, ...wire } = wireCall(call, existing.length + i); return wire; })];
    if (choice.finish_reason === OPENAI_FINISH.STOP) choice.finish_reason = OPENAI_FINISH.TOOL_CALLS;
  }
  return response;
}

/**
 * Decode DSML frames carried inside a native Claude message's text blocks.
 *
 * The Claude transport has no OpenAI `tool_calls` field to decode into, so the
 * frames would stay literal text in the delivered message. Decoded frames
 * become `tool_use` blocks placed right after the text block that held them;
 * a turn that gained a tool call reports the `tool_use` stop reason.
 *
 * @param {object} message - Native Claude message, mutated in place.
 * @param {string} model - Effective upstream model id.
 * @param {string} provider - Upstream provider key.
 * @returns {boolean} True when the message changed.
 */
export function normalizeDsmlClaudeMessage(message, model, provider) {
  if (!isDeepSeekFamilyModel(model, provider)) return false;
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return false;
  const decoded = [];
  let changed = false;
  let index = 0;
  for (const block of blocks) {
    if (block?.type !== CLAUDE_BLOCK.TEXT || !isString(block.text)) {
      decoded.push(block);
      continue;
    }
    const parsed = parseDsmlToolCalls(block.text);
    if (!parsed.toolCalls.length) {
      decoded.push(block);
      continue;
    }
    changed = true;
    if (parsed.content) decoded.push({ ...block, text: parsed.content });
    for (const call of parsed.toolCalls) {
      decoded.push({
        type: CLAUDE_BLOCK.TOOL_USE,
        id: fallbackToolCallId(index++),
        name: call.name,
        input: call.arguments
      });
    }
  }
  if (!changed) return false;
  message.content = decoded;
  if (message.stop_reason === CLAUDE_STOP.END_TURN) message.stop_reason = CLAUDE_STOP.TOOL_USE;
  return true;
}
