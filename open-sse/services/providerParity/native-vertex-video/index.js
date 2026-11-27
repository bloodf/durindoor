// Staged Vertex Veo video parity bundle. Not imported by production code;
// see ./registration.json for how the registration change wires it in.
export { default as vertexVideoAdapter, createVertexVideoAdapter, VERTEX_VIDEO_RESPONSE_FORMATS } from "./adapter.js";
export * from "./config.js";
export { buildVertexVideoRequest } from "./request.js";
export { vertexVideoScope, resolveVertexVideoAuth, vertexVideoAction, defaultVertexTokenMinter, VERTEX_EXPRESS_ORIGIN } from "./auth.js";
export {
  runVertexVideoJob,
  vertexVideoAcceptedJob,
  isVertexVideoOperationName,
  vertexVideoMp4Base64,
  VERTEX_VIDEO_POLL_INTERVAL_MS,
  VERTEX_VIDEO_TIMEOUT_MS,
  VERTEX_VIDEO_SUBMIT_TIMEOUT_MS,
  VERTEX_VIDEO_REQUEST_TIMEOUT_MS,
  VERTEX_VIDEO_TOKEN_TIMEOUT_MS,
  VERTEX_VIDEO_MAX_RESULT_BYTES,
} from "./job.js";
