import { isObject, isString } from "@/shared/utils/typeChecks.js";

/**
 * Default media routes: a request to a media endpoint without a `model` (or
 * with `model: "auto"`) runs the endpoint's route, an ordered list of models
 * tried first to last.
 *
 * The code ships no default model. Candidates are the models `/v1/models/{kind}`
 * publishes: active connections (or enabled keyless providers) whose provider
 * serves the kind, filtered to models of that kind and the provider allowlists.
 * A route saved in the dashboard (`settings.mediaRoutes[kind]`) sets the order;
 * saved models that are no longer available are skipped. With nothing saved,
 * every candidate is used in catalog order.
 */
export const MEDIA_ROUTE_KINDS = Object.freeze([
  { id: "tts", label: "Text to speech", endpoint: "/v1/audio/speech" },
  { id: "stt", label: "Speech to text", endpoint: "/v1/audio/transcriptions" },
  { id: "webSearch", label: "Web search", endpoint: "/v1/search" },
  { id: "webFetch", label: "Web fetch", endpoint: "/v1/web/fetch" },
  { id: "embedding", label: "Embeddings", endpoint: "/v1/embeddings" },
  { id: "image", label: "Image generation", endpoint: "/v1/images/generations" },
  { id: "video", label: "Video generation", endpoint: "/v1/video/generations" },
  { id: "music", label: "Music generation", endpoint: "/v1/music/generations" }
]);

const KIND_IDS = new Set(MEDIA_ROUTE_KINDS.map((k) => k.id));
export const MAX_ROUTE_MODELS = 50;
const MAX_MODEL_ID_LENGTH = 256;

export const isMediaRouteKind = (kind) => KIND_IDS.has(kind);

/** True when the request leaves model choice to the endpoint's default route. */
export function wantsDefaultRoute(model) {
  if (model === undefined || model === null) return true;
  return isString(model) && ["", "auto"].includes(model.trim().toLowerCase());
}

/**
 * Validate one saved route. Returns the cleaned, de-duplicated list, or null
 * when the value is not a list of model ids.
 */
export function normalizeRouteModels(value) {
  if (!Array.isArray(value) || value.length > MAX_ROUTE_MODELS) return null;
  const out = [];
  for (const item of value) {
    if (!isString(item)) return null;
    const id = item.trim();
    if (!id || id.length > MAX_MODEL_ID_LENGTH || !id.includes("/")) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Validate the whole `mediaRoutes` settings value; null when invalid. */
export function normalizeMediaRoutes(value) {
  // isObject() also accepts null.
  if (value === null || !isObject(value) || Array.isArray(value)) return null;
  const out = {};
  for (const [kind, models] of Object.entries(value)) {
    if (!isMediaRouteKind(kind)) return null;
    const normalized = normalizeRouteModels(models);
    if (!normalized) return null;
    out[kind] = normalized;
  }
  return out;
}
