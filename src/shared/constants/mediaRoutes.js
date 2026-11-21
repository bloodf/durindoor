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

/**
 * The transport that serves each media kind, and the endpoints that run it.
 *
 * The registry already describes this per provider: `serviceKinds` names the
 * kinds a provider serves, and each kind has its own config block
 * (`ttsConfig`, `sttConfig`, `videoConfig`, …). A provider can run a kind
 * only when it carries that transport, so the table below is the shared
 * vocabulary for "can this provider serve this kind on this endpoint".
 */
export const MEDIA_KIND_TRANSPORTS = Object.freeze({
  tts: Object.freeze({ configKey: "ttsConfig", endpoints: Object.freeze(["/v1/audio/speech"]) }),
  stt: Object.freeze({ configKey: "sttConfig", endpoints: Object.freeze(["/v1/audio/transcriptions", "/v1/audio/translations"]) }),
  webSearch: Object.freeze({ configKey: "searchConfig", endpoints: Object.freeze(["/v1/search"]) }),
  webFetch: Object.freeze({ configKey: "fetchConfig", endpoints: Object.freeze(["/v1/web/fetch"]) }),
  embedding: Object.freeze({ configKey: "embeddingConfig", endpoints: Object.freeze(["/v1/embeddings"]) }),
  image: Object.freeze({ configKey: "imageConfig", endpoints: Object.freeze(["/v1/images/generations"]) }),
  video: Object.freeze({ configKey: "videoConfig", endpoints: Object.freeze(["/v1/video/generations", "/v1/videos"]) }),
  music: Object.freeze({ configKey: "musicConfig", endpoints: Object.freeze(["/v1/music/generations"]) })
});

/** Endpoint path to the media kind it runs. */
export const MEDIA_ENDPOINT_KINDS = Object.freeze(
  Object.fromEntries(
    Object.entries(MEDIA_KIND_TRANSPORTS).flatMap(([kind, meta]) => meta.endpoints.map((path) => [path, kind]))
  )
);

/** The media kind an endpoint runs, or null when the path is not a media endpoint. */
export function mediaKindForEndpoint(path) {
  if (!isString(path)) return null;
  return MEDIA_ENDPOINT_KINDS[path] ?? null;
}

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
