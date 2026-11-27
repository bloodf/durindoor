// Arena (lmarena) image for /v1/images/generations: a FAIL-FAST adapter.
// Staged and NOT registered (see ./registration.json and
// internal/docs/port-reports/native-lmarena-image.md).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (lmarena) and
// open-sse/handlers/imageGeneration.ts. The pinned source routes lmarena image
// models through its generic OpenAI image forwarder, which sends no session
// cookie and no Arena envelope (see ./contract.js LMARENA_SOURCE_WIRE_DEFECTS).
// There is no native Arena image contract to port, so this adapter answers
// before any network call, credential read or billable submit:
//   - an id that is not one of the 27 source Image rows -> 400
//   - every other request -> 501 with LMARENA_IMAGE_UNSUPPORTED_REASON
// Nothing is submitted, so there is no acceptedJob, usage or quota effect, and
// the selected connection is never read or reported.
//
// responseFormats lists both public formats only so the image core's format
// check does not pre-empt the 501 diagnostic; no format is ever honored.
import { createErrorResult } from "../../../utils/error.js";
import { LMARENA_IMAGE_UNSUPPORTED_REASON, resolveLmarenaImageModel } from "./config.js";

export const LMARENA_IMAGE_NOT_IMPLEMENTED_STATUS = 501;
export const LMARENA_IMAGE_UNKNOWN_MODEL_STATUS = 400;
export const LMARENA_IMAGE_UNKNOWN_MODEL_MESSAGE = "Unknown Arena (lmarena) image model";
export const LMARENA_IMAGE_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);

/**
 * @param {object} [options]
 * @param {string} [options.unsupportedReason] - override for tests; defaults to the pinned reason
 */
export function createLmarenaImageAdapter({ unsupportedReason = LMARENA_IMAGE_UNSUPPORTED_REASON } = {}) {
  const reason = unsupportedReason || LMARENA_IMAGE_UNSUPPORTED_REASON;
  return {
    unsupported: true,
    responseFormats: LMARENA_IMAGE_RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** Never submits, so never bills. Does not read credentials, body media or the signal. */
    async generate({ model, body } = {}) {
      const requested = model ?? body?.model;
      if (!resolveLmarenaImageModel(requested)) {
        return createErrorResult(LMARENA_IMAGE_UNKNOWN_MODEL_STATUS, LMARENA_IMAGE_UNKNOWN_MODEL_MESSAGE);
      }
      return createErrorResult(LMARENA_IMAGE_NOT_IMPLEMENTED_STATUS, reason);
    },
  };
}

export default createLmarenaImageAdapter();
