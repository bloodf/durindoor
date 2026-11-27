import { createMediaRegistry, lookupMediaAdapter } from "../mediaRegistry.js";
// Synchronous video generation adapters for /v1/video/generations: each one
// submits a job, polls it within fixed bounds and returns the result once.
// The shared /v1/videos proxy (videoCore.js) is not used for these providers,
// because it hands job ids to the client and has no accepted-job ledger.
import alibaba from "./alibaba.js";
import renderhour from "./renderhour.js";
import adobeFireflyWeb from "./adobe-firefly-web.js";
import adobeFireflyApi from "./adobe-firefly-api.js";

export const VIDEO_GENERATION_ADAPTERS = createMediaRegistry({
  alibaba,
  ali: alibaba,
  renderhour,
  // Adobe's native video model through the Firefly Services API only.
  "adobe-firefly-api": adobeFireflyApi,
  "adobe-firefly-web": adobeFireflyWeb,
});

/** The adapter for `provider`, or null when it has none. */
export function getVideoGenerationAdapter(provider) {
  return lookupMediaAdapter(VIDEO_GENERATION_ADAPTERS, provider);
}

/** Output formats every adapter here can honor: result URLs, never downloaded. */
export const VIDEO_GENERATION_RESPONSE_FORMATS = Object.freeze(["url"]);
