// Staged, unregistered Hyperbolic native speech (TTS) adapter (#2034). Nothing
// in production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createHyperbolicTtsAdapter } from "./tts.js";

export * from "./config.js";
export { hyperbolicAcceptedJob } from "./http.js";
export { HYPERBOLIC_SPEECH_RESPONSE_FORMATS, buildHyperbolicSpeechRequest, createHyperbolicTtsAdapter, isMp3 } from "./tts.js";

/** Default instance: TTS_ADAPTERS under `hyperbolic` (and its `hyp` alias). */
export const hyperbolicTtsAdapter = createHyperbolicTtsAdapter();
