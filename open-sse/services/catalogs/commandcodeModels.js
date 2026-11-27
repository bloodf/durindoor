/**
 * CommandCode model discovery.
 *
 * CommandCode publishes the same catalog its own CLI polls — a public endpoint
 * (no auth, ETag = catalogVersion, refreshAfterSeconds: 900) that the CLI keeps
 * in ~/.commandcode/cache/model-catalog. The registry's static `models` array is
 * only an offline fallback: it lags every vendor release, so both the dashboard
 * provider page and GET /v1/models resolve the catalog live.
 */

import { isString } from "../../../src/shared/utils/typeChecks.js";
import commandcodeProvider from "../../providers/registry/commandcode.js";
import { createCatalogCache } from "./catalogCache.js";

export const COMMANDCODE_MODELS_URL = "https://api.commandcode.ai/provider/v1/models?view=client";

// No TTL: every lookup stays live. The endpoint is public, but `fetchImpl` carries
// the egress route, so only concurrent calls with the same transport share it.
const catalogCache = createCatalogCache();

/**
 * Catalog rows carry display copy plus capability flags. `hidden` entries are
 * the free/stealth aliases the vendor CLI keeps out of its own picker.
 */
export function parseCommandCodeModels(data) {
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .filter((model) => isString(model?.id) && model.id.trim() && !model.hidden)
    .map((model) => {
      const modalities = Array.isArray(model.inputModalities) ? model.inputModalities : [];
      const efforts = Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : [];
      return {
        id: model.id,
        name: model.display?.label || model.name || model.id,
        description: model.display?.description || null,
        contextLength: model.context_length,
        maxOutputTokens: model.maxOutputTokens ?? undefined,
        isVL: modalities.includes("image"),
        isReasoning: efforts.length > 0
      };
    });
}

/**
 * Fetch the live catalog. Returns null when the vendor endpoint is unreachable
 * or answers non-2xx so callers can fall back to their static list.
 */
export async function resolveCommandCodeModels(fetchImpl = fetch) {
  return catalogCache.load(fetchImpl, () => fetchCommandCodeCatalog(fetchImpl));
}

async function fetchCommandCodeCatalog(fetchImpl) {
  try {
    const response = await fetchImpl(COMMANDCODE_MODELS_URL, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { ...commandcodeProvider.transport.headers }
    });
    if (!response?.ok) return null;
    const models = parseCommandCodeModels(await response.json());
    return models.length > 0 ? { models } : null;
  } catch {
    return null;
  }
}
