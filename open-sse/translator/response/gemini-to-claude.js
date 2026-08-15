import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { GEMINI_ERROR_FINISH_REASONS } from "../schema/finishReasons.js";
import { buildGeminiThoughtSignatureKey, storeGeminiThoughtSignature } from "../../services/geminiThoughtSignatureStore.js";

function restoreToolName(name, toolNameMap) {
  if (!(toolNameMap instanceof Map)) return name;
  return toolNameMap.get(name) || toolNameMap.get(String(name).toLowerCase()) || name;
}

function readInlineSignature(part) {
  return typeof part.thoughtSignature === "string" && part.thoughtSignature || typeof part.thought_signature === "string" && part.thought_signature || null;
}

export function geminiToClaudeResponse(chunk, state) {
  if (!chunk) return null;
  const response = chunk.response || chunk;
  const candidate = response?.candidates?.[0];
  if (!candidate) return null;
  if (!Array.isArray(state.standaloneSignatureQueue)) state.standaloneSignatureQueue = [];
  const results = [];
  if (!state.messageId) {
    state.messageId = response.responseId || `msg_${Date.now()}`;
    state.model = response.modelVersion || "gemini";
    state.contentBlockIndex = 0;
    state.openTextBlockIdx = null;
    results.push({ type: "message_start", message: { id: state.messageId, type: "message", role: "assistant", model: state.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  }
  for (const part of candidate.content?.parts || []) {
    const inlineSignature = readInlineSignature(part);
    if (!part.functionCall && inlineSignature) state.standaloneSignatureQueue.push(inlineSignature);
    if (part.thought === true && part.text) {
      const index = state.contentBlockIndex++;
      results.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } }, { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: part.text } }, { type: "content_block_stop", index });
      continue;
    }
    if (part.functionCall) {
      if (state.openTextBlockIdx !== null) { results.push({ type: "content_block_stop", index: state.openTextBlockIdx }); state.openTextBlockIdx = null; }
      const index = state.contentBlockIndex++;
      const call = part.functionCall;
      const id = call.id || `toolu_${Date.now()}_${index}`;
      const callSignature = inlineSignature || (state.standaloneSignatureQueue.length ? state.standaloneSignatureQueue.shift() : null);
      if (callSignature) storeGeminiThoughtSignature(buildGeminiThoughtSignatureKey(state.signatureNamespace, id), callSignature);
      results.push({ type: "content_block_start", index, content_block: { type: "tool_use", id, name: restoreToolName(call.name, state.toolNameMap), input: {} } }, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.args || {}) } }, { type: "content_block_stop", index });
      state.hasToolUse = true;
      continue;
    }
    if (part.text) {
      if (state.openTextBlockIdx === null) { state.openTextBlockIdx = state.contentBlockIndex++; results.push({ type: "content_block_start", index: state.openTextBlockIdx, content_block: { type: "text", text: "" } }); }
      results.push({ type: "content_block_delta", index: state.openTextBlockIdx, delta: { type: "text_delta", text: part.text } });
    }
  }
  const usage = response.usageMetadata || chunk.usageMetadata;
  if (usage && typeof usage === "object") {
    state.usage = { input_tokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : 0, output_tokens: (typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0) + (typeof usage.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : 0) };
    if (typeof usage.cachedContentTokenCount === "number" && usage.cachedContentTokenCount > 0) state.usage.cache_read_input_tokens = usage.cachedContentTokenCount;
  }
  if (candidate.finishReason) {
    if (state.openTextBlockIdx !== null) { results.push({ type: "content_block_stop", index: state.openTextBlockIdx }); state.openTextBlockIdx = null; }
    const reason = candidate.finishReason.toUpperCase();
    const stopReason = state.hasToolUse || reason === "TOOL_CALLS" || GEMINI_ERROR_FINISH_REASONS.has(reason) ? "tool_use" : reason === "MAX_TOKENS" || reason === "LENGTH" ? "max_tokens" : "end_turn";
    results.push({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: state.usage || { input_tokens: 0, output_tokens: 0 } }, { type: "message_stop" });
  }
  return results.length ? results : null;
}

register(FORMATS.GEMINI, FORMATS.CLAUDE, null, geminiToClaudeResponse);
register(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, geminiToClaudeResponse);
