import REGISTRY from "open-sse/providers/registry/index.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { LOCAL_REQUEST_ERROR } from "open-sse/services/combo.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { effectiveSyncedModels, isModelAutoSyncEnabled } from "@/lib/modelAutoSync/catalog.js";
import { getCustomModels, getSyncedModelCatalog } from "@/lib/localDb";

/** Reject known non-image registry models; unknown and custom models remain dispatchable. */
export async function imageModelKindError(provider, model, settings) {
  const entry = REGISTRY.find((item) => item.id === provider);
  const matches = (entry?.models || []).filter((item) => item.id === model || item.aliases?.includes(model));
  if (!matches.length || matches.some((item) => (item.kind || item.type || "llm") === "image")) return null;
  const ids = new Set([model, ...matches.map((item) => item.id)]);
  try {
    const custom = await getCustomModels();
    if (custom.some((item) => resolveProviderId(item.providerAlias) === provider && ids.has(item.id) && (item.kind || item.type) === "image")) return null;
    const synced = isModelAutoSyncEnabled(provider, settings) ? effectiveSyncedModels(await getSyncedModelCatalog(provider), entry.models) : null;
    if (synced?.some((item) => ids.has(item.id) && (item.kind || item.type) === "image")) return null;
  } catch {
    // A missing override cannot be established while metadata is unavailable.
    const response = errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Image model metadata is temporarily unavailable.");
    response[LOCAL_REQUEST_ERROR] = true;
    return response;
  }
  return errorResponse(HTTP_STATUS.BAD_REQUEST, `Model '${provider}/${model}' cannot be used for image generation or editing.`);
}
