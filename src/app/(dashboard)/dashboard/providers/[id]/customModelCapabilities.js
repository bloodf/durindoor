// Resolve capabilities for a custom model, merging persisted caps over the
// provider/pattern fallback so UI and API consumers see declared overrides.
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

export function buildCustomCapabilities({
  booleanCaps,
  contextWindow,
  maxOutput,
  thinkingFormat,
  thinkingCanDisable,
  thinkingRangeMin,
  thinkingRangeMax,
}) {
  const out = { ...booleanCaps };
  const cw = contextWindow?.toString().trim() ?? "";
  const mo = maxOutput?.toString().trim() ?? "";
  const tf = thinkingFormat?.toString().trim() ?? "";
  out.contextWindow = cw === "" ? null : Number(cw);
  out.maxOutput = mo === "" ? null : Number(mo);
  out.thinkingFormat = tf === "" ? null : tf;
  if (thinkingCanDisable !== undefined) out.thinkingCanDisable = thinkingCanDisable;
  const trMin = thinkingRangeMin?.toString().trim() ?? "";
  const trMax = thinkingRangeMax?.toString().trim() ?? "";
  out.thinkingRange = trMin === "" && trMax === "" ? null : { min: trMin === "" ? null : Number(trMin), max: trMax === "" ? null : Number(trMax) };
  return out;
}

export function getCustomModelCapabilities({ providerId, modelId, capabilities }) {
  const fallback = getCapabilitiesForModel(providerId, modelId);
  if (!capabilities || Object.keys(capabilities).length === 0) return fallback;
  return { ...fallback, ...capabilities };
}
