// Private Fireworks contract guard (#2034). OmniRoute c71f0065's generic
// OpenAI route is not established by current primary Fireworks sources.
// No guessed workflow, poll method, artifact shape or model alias is dispatched.
// Source inventory is preserved in config.js; evidence is in the port report.
import { createErrorResult } from "../../../utils/error.js";
import { FIREWORKS_PROVIDER_ID, FIREWORKS_SUPPORTED_IMAGE_MODELS } from "./config.js";

const UNRESOLVED = "Fireworks image source contract is unresolved; native image dispatch is disabled";

/** No billable body can be built until a primary source establishes the contract. */
export function buildFireworksImageRequest() {
  throw Object.assign(new Error(UNRESOLVED), { status: 400 });
}

/**
 * Fail before examining credentials or starting work. There is no accepted job,
 * retry, upload, result download or polling while the contract is unresolved.
 * Closed transport mocks cannot establish vendor endpoint support.
 */
export function createFireworksImageAdapter() {
  return {
    provider: FIREWORKS_PROVIDER_ID,
    format: "source-unresolved",
    models: FIREWORKS_SUPPORTED_IMAGE_MODELS,
    supportedSizes: [],
    responseFormats: [],
    async generate() {
      return createErrorResult(400, UNRESOLVED);
    },
  };
}
