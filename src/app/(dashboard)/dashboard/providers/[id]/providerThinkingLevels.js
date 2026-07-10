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
    if (lv) lv.forEach((l) => { if (l !== "none") set.add(l); });
  };
  for (const m of models) addLevels(m.id);
  for (const m of kiloFreeModels) addLevels(m.id);
  for (const entry of customModels) {
    if (entry.providerAlias !== providerStorageAlias) continue;
    if ((entry.kind || entry.type || "llm") !== "llm") continue;
    addLevels(entry.id);
  }
  return set.size ? ["auto", ...[...set]] : null;
}
