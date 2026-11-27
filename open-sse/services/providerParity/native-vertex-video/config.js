// Vertex AI Veo video: provider metadata for the staged, unregistered adapter
// in ./adapter.js. Nothing here is imported by production code yet; the
// shared registry, catalog and videoProviders/index.js stay untouched until
// the serial registration change (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts, the `vertex` entry (base
// https://us-central1-aiplatform.googleapis.com/v1, authType "apikey",
// authHeader "bearer", format "vertex-veo", five Veo `-001` model ids), and
// open-sse/executors/vertexMedia.ts (vertexGenerateVideo: predictLongRunning,
// fetchPredictOperation, 10 s poll interval, 5 min wait).
//
// Fork deviations: the location comes from the connection's existing
// `providerSpecificData.location` (the chat executor's field) instead of the
// source's `providerSpecificData.region`, and the project from the same fields
// the chat executor reads. Duration and aspect ratio are checked per model
// before submit instead of being forwarded raw.

/** The canonical provider id this adapter serves: the existing chat connection. */
export const VERTEX_VIDEO_PROVIDER_ID = "vertex";
/** Aliases of that provider in open-sse/providers/registry/vertex.js. */
export const VERTEX_VIDEO_PROVIDER_ALIASES = Object.freeze(["vx"]);
/** The source registry's format name. */
export const VERTEX_VIDEO_FORMAT = "vertex-veo";

/** The source's default region (videoRegistry.ts base URL, vertexMedia.ts DEFAULT_REGION). */
export const VERTEX_VIDEO_DEFAULT_LOCATION = "us-central1";

// Veo 2 takes 5 to 8 seconds; Veo 3 and 3.1 take 4, 6 or 8. Both take 16:9 and 9:16.
const VEO2_SECONDS = Object.freeze([5, 6, 7, 8]);
const VEO3_SECONDS = Object.freeze([4, 6, 8]);
export const VERTEX_VIDEO_ASPECT_RATIOS = Object.freeze(["16:9", "9:16"]);

/** The five models of the source's `vertex` video entry, in source order. */
export const VERTEX_VIDEO_MODELS = Object.freeze([
  Object.freeze({ id: "veo-3.1-generate-001", name: "Veo 3.1 (Vertex)", durations: VEO3_SECONDS }),
  Object.freeze({ id: "veo-3.1-fast-generate-001", name: "Veo 3.1 Fast (Vertex)", durations: VEO3_SECONDS }),
  Object.freeze({ id: "veo-3.0-generate-001", name: "Veo 3.0 (Vertex)", durations: VEO3_SECONDS }),
  Object.freeze({ id: "veo-3.0-fast-generate-001", name: "Veo 3.0 Fast (Vertex)", durations: VEO3_SECONDS }),
  Object.freeze({ id: "veo-2.0-generate-001", name: "Veo 2.0 (Vertex)", durations: VEO2_SECONDS }),
]);
export const VERTEX_VIDEO_MODEL_IDS = Object.freeze(VERTEX_VIDEO_MODELS.map((model) => model.id));

/** Catalog metadata the registration change adds to the `vertex` provider. */
export const VERTEX_VIDEO_PROVIDER_METADATA = Object.freeze({
  id: VERTEX_VIDEO_PROVIDER_ID,
  aliases: VERTEX_VIDEO_PROVIDER_ALIASES,
  format: VERTEX_VIDEO_FORMAT,
  serviceKinds: Object.freeze(["video"]),
  videoModels: Object.freeze(VERTEX_VIDEO_MODELS.map(({ id, name }) => Object.freeze({ id, name }))),
  responseFormats: Object.freeze(["b64_json"]),
  endpoints: Object.freeze({
    submit: "POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predictLongRunning",
    poll: "POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:fetchPredictOperation",
    expressSubmit: "POST https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:predictLongRunning?key={apiKey}",
    expressPoll: "POST https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:fetchPredictOperation?key={apiKey}",
  }),
});

/** The model entry for `id`, or null. */
export function vertexVideoModel(id) {
  return VERTEX_VIDEO_MODELS.find((model) => model.id === id) ?? null;
}
