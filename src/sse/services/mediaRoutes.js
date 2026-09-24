import { buildModelsList } from "@/app/api/v1/models/buildModelsList.js";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { getVideoConfig } from "open-sse/handlers/videoCore.js";
import { supportsVideoGeneration } from "open-sse/handlers/videoGenerationCore.js";
import { supportsSttTranslation } from "open-sse/handlers/sttCore.js";
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
export async function listMediaRouteCandidates(kind, { apiKeyId = null } = {}) {
  const list = (await buildModelsList([kind], getProviderValidationGuard(), { exposeComboOnly: false }))
    .filter((m) => m?.owned_by !== "combo" && isString(m?.id) && (!m.kind || m.kind === kind));
  const providers = [...new Set(list.map((m) => providerOfModelId(m.id)))];
  const working = new Map(await Promise.all(providers.map(async (p) => [p, await isKeylessProviderWorking(p, { apiKeyId })])));
  return list.filter((m) => working.get(providerOfModelId(m.id)));
}

/** /v1/videos runs async job APIs; veoaifree-web's videoConfig is the sync generator. */
export const supportsVideoJobs = (providerId) => !!getVideoConfig(providerId) && !supportsVideoGeneration(providerId);
export const supportsTranslation = (providerId) => supportsSttTranslation(AI_PROVIDERS[providerId]?.sttConfig);

/** Endpoints that can run only part of their kind's models, shown per endpoint on the dashboard. */
export const MEDIA_ROUTE_ENDPOINTS = Object.freeze({
  video: [
    { path: "/v1/video/generations", supports: supportsVideoGeneration },
    { path: "/v1/videos", supports: supportsVideoJobs }
  ],
  stt: [
    { path: "/v1/audio/transcriptions", supports: null },
    { path: "/v1/audio/translations", supports: supportsTranslation }
  ]
});

function kindLabel(kind) {
  return MEDIA_ROUTE_KINDS.find((k) => k.id === kind)?.label.toLowerCase() || kind;
}

function noRouteResponse(kind, reason) {
  const message = {
    saved: `None of the models in the ${kindLabel(kind)} route are available. Update it in Dashboard > Media Routes, or pass a model.`,
    endpoint: `None of the models in the ${kindLabel(kind)} route can run on this endpoint. Add one it supports in Dashboard > Media Routes, or pass a model.`,
    none: `No connected provider supports ${kindLabel(kind)} on this endpoint. Connect one in Dashboard > Media Providers, or pass a model.`
  }[reason];
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
 * @param {string|null} [options.apiKeyId] - the caller's key, which decides the host a keyless provider is probed at
 */
export async function describeMediaRoute(kind, { settings, supports = null, apiKeyId = null } = {}) {
  const all = await listMediaRouteCandidates(kind, { apiKeyId });
  const candidates = supports ? all.filter((m) => supports(providerOfModelId(m.id))) : all;
  const saved = savedRoute(settings, kind);
  const available = new Set(candidates.map((m) => m.id));
  // A saved route is the user's choice: an endpoint that can run none of its
  // models (a sync-only video model on /v1/videos, a Deepgram-only STT route on
  // /v1/audio/translations) errors rather than starting work on a provider the
  // route never named.
  let models = saved.length > 0 ? saved.filter((id) => available.has(id)) : candidates.map((m) => m.id);
  // Vectors from different embedding models are not comparable, so an
  // embeddings route never falls through to a second model.
  if (kind === "embedding") models = models.slice(0, 1);
  const allIds = new Set(all.map((m) => m.id));
  const reason = saved.length === 0 ? "none" : saved.some((id) => allIds.has(id)) ? "endpoint" : "saved";
  return { saved, candidates, models, reason };
}

/**
 * Resolve the ordered model list for a request without a model.
 * @returns {Promise<{ models: string[] } | { error: Response }>}
 */
export async function resolveMediaRoute(kind, options = {}) {
  const { models, reason } = await describeMediaRoute(kind, options);
  if (models.length === 0) return { error: noRouteResponse(kind, reason) };
  return { models };
}

/** Combo-runner options for a default route (strict order, no rotation). */
export function defaultRouteComboOptions(kind) {
  return {
    comboName: `media-route:${kind}`,
    comboStrategy: "fallback",
    autoSwitch: false,
    checkEmptyBody: false,
    comboMembers: []
  };
}
