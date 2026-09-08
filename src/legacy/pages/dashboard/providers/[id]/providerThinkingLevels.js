import { getThinkingLevelsFromCapabilities } from "open-sse/providers/thinkingLevels.js";
import { getCustomModelCapabilities } from "./customModelCapabilities";

export function getProviderThinkingLevels({
  providerId,
  models = [],
  kiloFreeModels = [],
  customModels = [],
  providerStorageAlias,
}) {
  const set = new Set();
  const seen = new Set();
  const addLevels = (modelId, customCaps) => {
    if (!modelId || seen.has(modelId)) return;
    seen.add(modelId);
    const caps = getCustomModelCapabilities({ providerId, modelId, capabilities: customCaps });
    const lv = getThinkingLevelsFromCapabilities(caps, providerId, modelId);
    if (lv) lv.forEach((l) => set.add(l));
  };
  for (const m of models) addLevels(m.id);
  for (const m of kiloFreeModels) addLevels(m.id);
  for (const entry of customModels) {
    if (entry.providerAlias !== providerStorageAlias) continue;
    if ((entry.kind || entry.type || "llm") !== "llm") continue;
    addLevels(entry.id, entry.capabilities);
  }
  if (!set.size) return null;
  const rest = [...set].filter((l) => l !== "none");
  return ["auto", "none", ...rest];
}
