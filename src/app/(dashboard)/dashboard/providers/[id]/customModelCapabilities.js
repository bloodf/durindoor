// Resolve capabilities for a custom model, merging persisted caps over the
// provider/pattern fallback so UI and API consumers see declared overrides.
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

export function getCustomModelCapabilities({ providerId, modelId, capabilities }) {
  const fallback = getCapabilitiesForModel(providerId, modelId);
  if (!capabilities || Object.keys(capabilities).length === 0) return fallback;
  return { ...fallback, ...capabilities };
}
