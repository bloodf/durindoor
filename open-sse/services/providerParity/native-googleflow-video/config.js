// Google Flow (labs.google/flow) Veo video: provider metadata for the staged,
// unregistered, fail-fast adapter in ./adapter.js. Nothing here is imported by
// production code; the shared registry, catalog and videoProviders/index.js
// stay untouched (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts, the `googleflow` entry. The source marks
// the entry `unsupported: true` (#10285): its submit/poll paths 404 on
// aisandbox-pa, the only path reported to work is undocumented, and that path
// rejects the stored Cloud Code OAuth bearer with 401. The source handler
// (handlers/videoGeneration/googleFlowHandler.ts) therefore returns 501 before
// any network call. This bundle keeps that state: it is NOT a working provider.

export const GOOGLE_FLOW_VIDEO_PROVIDER_ID = "googleflow";
export const GOOGLE_FLOW_VIDEO_PROVIDER_ALIASES = Object.freeze(["flow"]);
export const GOOGLE_FLOW_VIDEO_FORMAT = "google-flow";

/** Source registry fields, verbatim. */
export const GOOGLE_FLOW_HOST = "https://aisandbox-pa.googleapis.com";
export const GOOGLE_FLOW_AUTH_TYPE = "oauth";
export const GOOGLE_FLOW_AUTH_HEADER = "bearer";

/**
 * The source registry's `unsupportedReason`, verbatim. The adapter answers
 * every request with it.
 */
export const GOOGLE_FLOW_UNSUPPORTED_REASON =
  "Google Flow video generation requires a browser-session transport " +
  "(Flow/Cloud Code session with reCAPTCHA) and is not supported over the stored " +
  "OAuth bearer. Generate video via labs.google/flow directly for now.";

/** Source handler fallback, verbatim (used when the registry has no reason). */
export const GOOGLE_FLOW_FALLBACK_UNSUPPORTED_REASON =
  "Google Flow video generation requires a browser-session transport and is not " +
  "supported over the stored OAuth bearer.";

/**
 * Source wire paths (googleFlow.ts). Both are live-confirmed 404 in the source
 * (#10285) and are kept only as evidence; nothing here calls them.
 */
export const GOOGLE_FLOW_SUBMIT_PATH = "/v1:generateVideo";
export const GOOGLE_FLOW_POLL_PATH = "/v1:fetchOperation";
/** The undocumented path the #10285 reporter measured; 401s with the OAuth bearer. Not implemented. */
export const GOOGLE_FLOW_REPORTED_WORKING_PATH = "/v1/video:batchAsyncGenerateVideoText";

/**
 * Source credential mapping: googleflow has no connection of its own and reads
 * the Antigravity Google OAuth credential (accessToken + Cloud Code projectId).
 */
export const GOOGLE_FLOW_CREDENTIAL_PROVIDER = "antigravity";

/** The source entry's three models, in source order. */
export const GOOGLE_FLOW_VIDEO_MODELS = Object.freeze([
  Object.freeze({ id: "veo-3.1-generate", name: "Veo 3.1 (Google Flow)" }),
  Object.freeze({ id: "veo-3.1-fast-generate", name: "Veo 3.1 Fast (Google Flow)" }),
  Object.freeze({ id: "veo-3.0-generate", name: "Veo 3.0 (Google Flow)" }),
]);
export const GOOGLE_FLOW_VIDEO_MODEL_IDS = Object.freeze(GOOGLE_FLOW_VIDEO_MODELS.map((model) => model.id));

/** Metadata the registration change may consult. `supported: false` is the source state. */
export const GOOGLE_FLOW_VIDEO_PROVIDER_METADATA = Object.freeze({
  id: GOOGLE_FLOW_VIDEO_PROVIDER_ID,
  aliases: GOOGLE_FLOW_VIDEO_PROVIDER_ALIASES,
  format: GOOGLE_FLOW_VIDEO_FORMAT,
  baseUrl: GOOGLE_FLOW_HOST,
  authType: GOOGLE_FLOW_AUTH_TYPE,
  authHeader: GOOGLE_FLOW_AUTH_HEADER,
  credentialProvider: GOOGLE_FLOW_CREDENTIAL_PROVIDER,
  serviceKinds: Object.freeze(["video"]),
  videoModels: GOOGLE_FLOW_VIDEO_MODELS,
  supported: false,
  unsupported: true,
  unsupportedReason: GOOGLE_FLOW_UNSUPPORTED_REASON,
  supportedResponseFormats: Object.freeze([]),
  endpoints: Object.freeze({
    submit: `POST ${GOOGLE_FLOW_HOST}${GOOGLE_FLOW_SUBMIT_PATH} (404 per source #10285; not called)`,
    poll: `POST ${GOOGLE_FLOW_HOST}${GOOGLE_FLOW_POLL_PATH} (404 per source #10285; not called)`,
    reportedWorking: `POST ${GOOGLE_FLOW_HOST}${GOOGLE_FLOW_REPORTED_WORKING_PATH} (401 with OAuth bearer per source #10285; not implemented)`,
  }),
  dynamicDiscovery: "none in source; static model list",
});

/** The model entry for `id`, or null. */
export function googleFlowVideoModel(id) {
  return GOOGLE_FLOW_VIDEO_MODELS.find((model) => model.id === id) ?? null;
}
