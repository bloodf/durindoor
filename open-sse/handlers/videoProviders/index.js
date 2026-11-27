import falVideo from "../../services/providerParity/native-fal-ai-video/adapter.js";
import { kieVideoAdapter } from "../../services/providerParity/native-kie-video-image/index.js";
import { createMediaRegistry, lookupMediaAdapter } from "../mediaRegistry.js";
// Synchronous video generation adapters for /v1/video/generations: each one
// submits a job, polls it within fixed bounds and returns the result once.
// The shared /v1/videos proxy (videoCore.js) is not used for these providers,
// because it hands job ids to the client and has no accepted-job ledger.
import alibaba from "./alibaba.js";
import renderhour from "./renderhour.js";
import adobeFireflyWeb from "./adobe-firefly-web.js";
import adobeFireflyApi from "./adobe-firefly-api.js";
import { agnesVideoAdapter as agnes } from "../../services/providerParity/native-agnes-video-image/index.js";
import vertex from "../../services/providerParity/native-vertex-video/adapter.js";
import { haiperVideoAdapter } from "../../services/providerParity/native-haiper-video-image/index.js";
import { leonardoVideoAdapter } from "../../services/providerParity/native-leonardo-video-image/index.js";
import veoAiFree from "../../services/providerParity/native-veoaifree-web-video/index.js";

export const VIDEO_GENERATION_ADAPTERS = createMediaRegistry({
  "fal-ai": falVideo,
  fal: falVideo,
  kie: kieVideoAdapter,
  alibaba,
  ali: alibaba,
  renderhour,
  // Agnes submit-and-poll jobs on the fixed apihub origin; result URLs only.
  agnes,
  // Vertex AI Veo long-running operations; the MP4 returns as b64_json only.
  vertex,
  vx: vertex,
  // Adobe's native video model through the Firefly Services API only.
  "adobe-firefly-api": adobeFireflyApi,
  "adobe-firefly-web": adobeFireflyWeb,
  // Haiper Gen 2 and Leonardo Motion jobs on fixed origins; result URLs only.
  haiper: haiperVideoAdapter,
  hp: haiperVideoAdapter,
  leonardo: leonardoVideoAdapter,
  leo: leonardoVideoAdapter,
  // Veo AI Free WordPress AJAX: anonymous, or the selected connection's saved
  // session cookie on its own AJAX calls only. One submit, never replayed.
  "veoaifree-web": veoAiFree,
  "veo-free": veoAiFree,
});

/** The adapter for `provider`, or null when it has none. */
export function getVideoGenerationAdapter(provider) {
  return lookupMediaAdapter(VIDEO_GENERATION_ADAPTERS, provider);
}

/** Output formats every adapter here can honor: result URLs, never downloaded. */
export const VIDEO_GENERATION_RESPONSE_FORMATS = Object.freeze(["url"]);
