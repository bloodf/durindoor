// Staged Segmind video parity bundle. Not imported by production code;
// see ./registration.json for how the registration change wires it in.
export { default as segmindVideoAdapter, createSegmindVideoAdapter } from "./adapter.js";
export * from "./config.js";
export {
  buildSegmindVideoRequest,
  SEGMIND_VIDEO_REFUSED_FIELDS,
  SEGMIND_VIDEO_MAX_PROMPT_LENGTH,
  SEGMIND_VIDEO_MAX_DURATION_SECONDS,
} from "./request.js";
export { runSegmindVideoJob, segmindVideoAcceptedJob, segmindVideoToken, isSegmindMp4 } from "./job.js";
