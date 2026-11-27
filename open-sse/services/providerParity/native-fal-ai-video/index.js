// Staged fal.ai video parity bundle. Not imported by production code;
// see ./registration.json for how the registration change wires it in.
export { default as falVideoAdapter, createFalVideoAdapter, FAL_VIDEO_RESPONSE_FORMATS } from "./adapter.js";
export * from "./config.js";
export {
  buildFalVideoRequest,
  falDiscoveredEndpoint,
  falImageReference,
  FAL_VEO_ASPECT_RATIOS,
  FAL_VEO_DURATIONS,
  FAL_VEO_RESOLUTIONS,
  FAL_GEMINI_SECONDS,
  FAL_VIDEO_MAX_DATA_URI_BYTES,
} from "./request.js";
export {
  assertFalVideoDefinition,
  discoverFalVideoDefinition,
  falVideoCompatibilityInput,
  falVideoInputSchema,
  validateFalVideoInput,
} from "./schema.js";
export {
  runFalVideoJob,
  falVideoAcceptedJob,
  falVideoToken,
  falVideoTrackingUrl,
  falVideoResultUrl,
  falVideoArtifact,
  FAL_VIDEO_POLL_INTERVAL_MS,
  FAL_VIDEO_TIMEOUT_MS,
  FAL_VIDEO_SUBMIT_TIMEOUT_MS,
  FAL_VIDEO_REQUEST_TIMEOUT_MS,
  FAL_VIDEO_DISCOVERY_TIMEOUT_MS,
  FAL_VIDEO_MAX_POLL_RETRIES,
} from "./job.js";
