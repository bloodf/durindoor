// Google Flow video for /v1/video/generations: a FAIL-FAST adapter. Staged and
// NOT registered (see ./registration.json and
// internal/docs/port-reports/native-googleflow-video.md).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/videoGeneration/googleFlowHandler.ts
// (handleGoogleFlowVideoGeneration) and the `google-flow` dispatch in
// open-sse/handlers/videoGeneration.ts. The source handler returns
// `{ success: false, status: 501, error: unsupportedReason }` for every request
// and never touches the network, credentials or the body. This adapter does
// the same through the job-adapter contract of handlers/videoGenerationCore.js:
// nothing is submitted, so there is no acceptedJob and no usage to record.
//
// responseFormats lists both public formats only so the core's format check
// does not pre-empt the 501 diagnostic; no format is ever honored.
import { createErrorResult } from "../../../utils/error.js";
import { GOOGLE_FLOW_FALLBACK_UNSUPPORTED_REASON, GOOGLE_FLOW_UNSUPPORTED_REASON } from "./config.js";

export const GOOGLE_FLOW_NOT_IMPLEMENTED_STATUS = 501;
export const GOOGLE_FLOW_VIDEO_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);

/**
 * @param {object} [options]
 * @param {string} [options.unsupportedReason] - the registry reason; the source falls back when it is empty
 */
export function createGoogleFlowVideoAdapter({ unsupportedReason = GOOGLE_FLOW_UNSUPPORTED_REASON } = {}) {
  const reason = unsupportedReason || GOOGLE_FLOW_FALLBACK_UNSUPPORTED_REASON;
  return {
    async: true,
    unsupported: true,
    responseFormats: GOOGLE_FLOW_VIDEO_RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** Always a 501 error result; never submits, so never bills. */
    async generate() {
      return createErrorResult(GOOGLE_FLOW_NOT_IMPLEMENTED_STATUS, reason);
    },
  };
}

export default createGoogleFlowVideoAdapter();
