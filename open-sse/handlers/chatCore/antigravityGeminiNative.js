import { isRecord } from "../../../src/shared/utils/typeChecks.js";

// Cloud Code wraps Gemini responses; retain all native fields and candidate parts.
export function antigravityGeminiResponse(chunk, aliases, defaultFinish = false) {
  const response = structuredClone(chunk?.response || chunk);
  if (!isRecord(response)) return response;
  if (Object.hasOwn(response, "cpaUsageMetadata")) {
    response.usageMetadata = response.cpaUsageMetadata;
    delete response.cpaUsageMetadata;
  }
  for (const candidate of response.candidates || []) {
    if (defaultFinish && !candidate.finishReason) candidate.finishReason = "STOP";
    for (const part of candidate?.content?.parts || []) {
      for (const key of ["functionCall", "functionResponse", "function_call", "function_response"]) {
        const call = part[key];
        if (call && aliases?.has(call.name)) call.name = aliases.get(call.name);
      }
    }
  }
  return response;
}

// Assemble streamed candidate fragments by index when a provider requires SSE
// but the client requested a single GenerateContentResponse.
export function collectAntigravityGeminiSSE(text, aliases) {
  let result = {};
  const candidates = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const chunk = JSON.parse(data);
    const response = antigravityGeminiResponse(chunk, aliases);
    if (!isRecord(response)) continue;
    const { candidates: items, ...metadata } = response;
    result = { ...result, ...metadata };
    for (const [position, candidate] of (items || []).entries()) {
      const index = candidate.index ?? position;
      const previous = candidates.get(index);
      if (!previous) { candidates.set(index, candidate); continue; }
      const parts = [...(previous.content?.parts || []), ...(candidate.content?.parts || [])];
      candidates.set(index, { ...previous, ...candidate, content: { ...previous.content, ...candidate.content, parts } });
    }
  }
  if (candidates.size) result.candidates = [...candidates.values()];
  return antigravityGeminiResponse(result, aliases, true);
}
