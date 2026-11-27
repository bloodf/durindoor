// Vertex AI Veo video: provider metadata for the staged, unregistered adapter
// in ./adapter.js. Nothing here is imported by production code yet; the
// shared registry, catalog and videoProviders/index.js stay untouched until
// the serial registration change (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts, the `vertex` entry (base
// https://us-central1-aiplatform.googleapis.com/v1, authType "apikey",
// authHeader "bearer", format "vertex-veo", five Veo `-001` model ids, three of
// them since retired; see below), and
// open-sse/executors/vertexMedia.ts (vertexGenerateVideo: predictLongRunning,
// fetchPredictOperation, 10 s poll interval, 5 min wait).
//
// Fork deviations: the location comes from the connection's existing
// `providerSpecificData.location` (the chat executor's field) instead of the
// source's `providerSpecificData.region`, and the project from the same fields
// the chat executor reads. Duration and aspect ratio are checked per model
// before submit instead of being forwarded raw. Only the two Veo 3.1 models
// are accepted: Google retired veo-3.0-generate-001, veo-3.0-fast-generate-001
// and veo-2.0-generate-001 on 2026-06-30 (retired-models table at
// https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions,
// checked 2026-11-27; Veo 3.1 and 3.1 Fast retire no earlier than 2027-05-04).
// The source still lists all five. A retired id is refused locally with 400 by
// buildVertexVideoRequest, before any token mint or request, and is never
// aliased or silently replaced with a current model.

/** The canonical provider id this adapter serves: the existing chat connection. */
export const VERTEX_VIDEO_PROVIDER_ID = "vertex";
/** Aliases of that provider in open-sse/providers/registry/vertex.js. */
export const VERTEX_VIDEO_PROVIDER_ALIASES = Object.freeze(["vx"]);
/** The source registry's format name. */
export const VERTEX_VIDEO_FORMAT = "vertex-veo";

/** The source's default region (videoRegistry.ts base URL, vertexMedia.ts DEFAULT_REGION). */
export const VERTEX_VIDEO_DEFAULT_LOCATION = "us-central1";

// Veo 3.1 and 3.1 Fast take 4, 6 or 8 seconds, at 16:9 or 9:16.
const VEO3_SECONDS = Object.freeze([4, 6, 8]);
export const VERTEX_VIDEO_ASPECT_RATIOS = Object.freeze(["16:9", "9:16"]);

/** The active Veo 3.1 models of the source's `vertex` video entry, in source order. */
export const VERTEX_VIDEO_MODELS = Object.freeze([
  Object.freeze({ id: "veo-3.1-generate-001", name: "Veo 3.1 (Vertex)", durations: VEO3_SECONDS }),
  Object.freeze({ id: "veo-3.1-fast-generate-001", name: "Veo 3.1 Fast (Vertex)", durations: VEO3_SECONDS }),
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
