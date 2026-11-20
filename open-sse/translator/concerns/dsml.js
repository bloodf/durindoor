import { createDsmlStreamState, isDeepSeekFamilyModel, parseDsmlToolCalls } from "../../utils/dsmlToolCalls.js";
import { fallbackToolCallId } from "./toolCall.js";
import { OPENAI_FINISH } from "../schema/finishReasons.js";
import { OPENAI_BLOCK } from "../schema/blocks.js";
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
        if (tail.text || entry.calls.length) output.push({ ...entry.template, choices: [{ index, delta: { ...(tail.text ? { content: tail.text } : {}), ...(entry.calls.length ? { tool_calls: entry.calls.map((call) => wireCall(call, ++entry.maxIndex)) } : {}) }, finish_reason: null }] });
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
      if (typeof delta.content === "string") {
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
    if (typeof message?.content !== "string") continue;
    const parsed = parseDsmlToolCalls(message.content);
    if (!parsed.toolCalls.length) continue;
    const existing = message.tool_calls || [];
    message.content = parsed.content || null;
    message.tool_calls = [...existing, ...parsed.toolCalls.map((call, i) => { const { index, ...wire } = wireCall(call, existing.length + i); return wire; })];
    if (choice.finish_reason === OPENAI_FINISH.STOP) choice.finish_reason = OPENAI_FINISH.TOOL_CALLS;
  }
  return response;
}
