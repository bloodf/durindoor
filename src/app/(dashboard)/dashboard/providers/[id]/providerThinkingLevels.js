import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

export function getProviderThinkingLevels({
  providerId,
  models = [],
  kiloFreeModels = [],
  customModels = [],
  providerStorageAlias,
}) {
  const set = new Set();
  const seen = new Set();
  const addLevels = (modelId) => {
    if (!modelId || seen.has(modelId)) return;
    seen.add(modelId);
    const lv = getThinkingLevels(providerId, modelId);
    // Upstream decolua/9router#2534: include "none" so the dashboard picker
    // can emit an explicit "strip reasoning" mode for non-reasoning models
    // (e.g. xAI grok-composer 400s if reasoning_effort is sent at all).
    if (lv) lv.forEach((l) => set.add(l));
  };
  for (const m of models) addLevels(m.id);
  for (const m of kiloFreeModels) addLevels(m.id);
  for (const entry of customModels) {
    if (entry.providerAlias !== providerStorageAlias) continue;
    if ((entry.kind || entry.type || "llm") !== "llm") continue;
    addLevels(entry.id);
  }
  if (!set.size) return null;
  const rest = [...set].filter((l) => l !== "none");
  return ["auto", "none", ...rest];
}
