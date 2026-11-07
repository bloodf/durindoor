import REGISTRY from "open-sse/providers/registry/index.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { LOCAL_REQUEST_ERROR } from "open-sse/services/combo.js";
import { getProviderByAlias, resolveProviderId } from "@/shared/constants/providers.js";
import { effectiveSyncedModels, isModelAutoSyncEnabled } from "@/lib/modelAutoSync/catalog.js";
import { getCustomModels, getSyncedModelCatalog, getProviderNodes } from "@/lib/localDb";

/**
 * Reject declared wrong kinds; untyped and unknown IDs remain dispatchable.
 * Chat also accepts imageToText and audio models that use chat completions.
 * Other endpoints keep exact-kind matching by default.
 */
export async function modelKindError(provider, model, settings, kind, acceptedKinds = [kind]) {
  const entry = REGISTRY.find((item) => item.id === provider);
  const matches = (entry?.models || []).filter((item) => item.id === model || item.aliases?.includes(model));
  if (matches.some((item) => acceptedKinds.includes(item.kind || item.type || "llm"))) return null;
  const ids = new Set([model, ...matches.map((item) => item.id)]);
  let knownWrong = matches.length > 0;
  let unavailable = false;
  const providerIds = new Set([provider]);
  if (!entry) {
    try {
      const nodes = await Promise.all(["openai-compatible", "anthropic-compatible", "custom-embedding", "systemone-compatible"].map((type) => getProviderNodes({ type })));
      const node = nodes.flat().find((item) => item.id === provider);
      if (node?.prefix && !getProviderByAlias(node.prefix)) providerIds.add(node.prefix);
    } catch {
      unavailable = true;
    }
  }
  try {
    const custom = await getCustomModels();
    const rows = custom.filter((item) => (providerIds.has(item.providerAlias) || providerIds.has(resolveProviderId(item.providerAlias))) && ids.has(item.id) && (item.kind || item.type));
    if (rows.some((item) => acceptedKinds.includes(item.kind || item.type))) return null;
    knownWrong ||= rows.length > 0;
  } catch {
    unavailable = true;
  }
  try {
    const synced = entry && isModelAutoSyncEnabled(provider, settings) ? effectiveSyncedModels(await getSyncedModelCatalog(provider), entry.models) : null;
    const rows = synced?.filter((item) => (ids.has(item.id) || item.aliases?.some((alias) => ids.has(alias))) && (item.kind || item.type)) || [];
    if (rows.some((item) => acceptedKinds.includes(item.kind || item.type))) return null;
    knownWrong ||= rows.length > 0;
  } catch {
    unavailable = true;
  }
  if (!knownWrong) return null;
  if (unavailable) {
    const response = errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Model metadata is temporarily unavailable.");
    response[LOCAL_REQUEST_ERROR] = true;
    return response;
  }
  return errorResponse(HTTP_STATUS.BAD_REQUEST, `Model '${provider}/${model}' cannot be used for ${kind}.`);
}
