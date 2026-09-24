import { buildModelsList } from "@/app/api/v1/models/buildModelsList.js";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { isKeylessProviderWorking } from "./keylessAvailability.js";
import { isString } from "@/shared/utils/typeChecks.js";
import { MEDIA_ROUTE_KINDS, normalizeRouteModels } from "@/shared/constants/mediaRoutes.js";

export {
  MEDIA_ROUTE_KINDS,
  MAX_ROUTE_MODELS,
  isMediaRouteKind,
  wantsDefaultRoute,
  normalizeRouteModels,
  normalizeMediaRoutes
} from "@/shared/constants/mediaRoutes.js";

const savedRoute = (settings, kind) => normalizeRouteModels(settings?.mediaRoutes?.[kind]) || [];

export const providerOfModelId = (id) => resolveProviderId(String(id).split("/")[0]);

/**
 * Models the user can route for `kind` right now, as `/v1/models/{kind}`
 * lists them (combos excluded; a route holds concrete models), minus keyless
 * providers that are not installed and working (see keylessAvailability.js).
 */
export async function listMediaRouteCandidates(kind) {
  const list = (await buildModelsList([kind], getProviderValidationGuard(), { exposeComboOnly: false }))
    .filter((m) => m?.owned_by !== "combo" && isString(m?.id) && (!m.kind || m.kind === kind));
  const providers = [...new Set(list.map((m) => providerOfModelId(m.id)))];
  const working = new Map(await Promise.all(providers.map(async (p) => [p, await isKeylessProviderWorking(p)])));
  return list.filter((m) => working.get(providerOfModelId(m.id)));
}

function kindLabel(kind) {
  return MEDIA_ROUTE_KINDS.find((k) => k.id === kind)?.label.toLowerCase() || kind;
}

function noRouteResponse(kind, hadSavedRoute) {
  const message = hadSavedRoute
    ? `None of the models in the ${kindLabel(kind)} route are available. Update it in Dashboard > Media Routes, or pass a model.`
    : `No connected provider supports ${kindLabel(kind)}. Connect one in Dashboard > Media Providers, or pass a model.`;
  return errorResponse(HTTP_STATUS.BAD_REQUEST, message, { type: "invalid_request_error", code: "no_provider_for_kind" });
}

/**
 * The route as it stands: `saved` (dashboard order, may name models that are
 * gone), `candidates` (what the user can route now), and `models` (what a
 * request without a model runs, in order).
 *
 * @param {string} kind - one of MEDIA_ROUTE_KINDS
 * @param {object} options
 * @param {object} options.settings - current settings
 * @param {(providerId: string) => boolean} [options.supports] - endpoint-specific provider filter
 */
export async function describeMediaRoute(kind, { settings, supports = null } = {}) {
  const candidates = (await listMediaRouteCandidates(kind))
    .filter((m) => !supports || supports(providerOfModelId(m.id)));
  const saved = savedRoute(settings, kind);
  const available = new Set(candidates.map((m) => m.id));
  let models = saved.length > 0 ? saved.filter((id) => available.has(id)) : candidates.map((m) => m.id);
  // Vectors from different embedding models are not comparable, so an
  // embeddings route never falls through to a second model.
  if (kind === "embedding") models = models.slice(0, 1);
  return { saved, candidates, models };
}

/**
 * Resolve the ordered model list for a request without a model.
 * @returns {Promise<{ models: string[] } | { error: Response }>}
 */
export async function resolveMediaRoute(kind, options = {}) {
  const { saved, models } = await describeMediaRoute(kind, options);
  if (models.length === 0) return { error: noRouteResponse(kind, saved.length > 0) };
  return { models };
}

/** Combo-runner options for a default route (strict order, no rotation). */
export function defaultRouteComboOptions(kind) {
  return {
    comboName: `media-route:${kind}`,
    comboStrategy: "fallback",
    autoSwitch: false,
    comboMembers: []
  };
}
