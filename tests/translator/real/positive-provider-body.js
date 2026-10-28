/**
 * Build positive capability probes without asking Kiro to enforce an output
 * ceiling it cannot honor (#1078). Explicit-limit rejection is tested offline.
 * Other providers retain their original ceilings. Thinking budgets are separate
 * from output ceilings and must remain intact, as must content and tool payloads.
 */
export function positiveProviderBody(providerId, body) {
  if (providerId !== "kiro") return body;
  const result = structuredClone(body);
  for (const payload of [result, result.request]) {
    if (!payload) continue;
    delete payload.max_tokens;
    delete payload.max_completion_tokens;
    delete payload.max_output_tokens;
    if (payload.generationConfig) delete payload.generationConfig.maxOutputTokens;
  }
  return result;
}
