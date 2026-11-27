// Staged fal.ai ACE-Step music parity bundle. Not imported by production code;
// see ./registration.json for how the registration change wires it in.
export { default as falMusicAdapter, createFalMusicAdapter, FAL_MUSIC_DISCOVERY_TIMEOUT_MS } from "./adapter.js";
export * from "./config.js";
export { buildFalMusicRequest, checkFalMusicEnvelope, falMusicCompatibilityInput, FAL_MUSIC_NUMBER_FIELDS, FAL_MUSIC_MIN_SECONDS, FAL_MUSIC_MAX_SECONDS } from "./request.js";
export { discoverFalDefinition, falDiscoveryUrl, falInputProperties, falInputSchema, prepareFalMusicInput, validateFalInput } from "./discovery.js";
export {
  runFalMusicJob,
  falMusicAcceptedJob,
  falMusicToken,
  FAL_MUSIC_POLL_INTERVAL_MS,
  FAL_MUSIC_TIMEOUT_MS,
  FAL_MUSIC_SUBMIT_TIMEOUT_MS,
  FAL_MUSIC_REQUEST_TIMEOUT_MS,
  FAL_MUSIC_MAX_RESULT_BYTES,
} from "./job.js";
export { normalizeFalMusicResult } from "./result.js";
export { assertFalTarget, falTrackingUrl, isFalRequestId, FAL_MUSIC_MAX_READ_RETRIES } from "./transport.js";
