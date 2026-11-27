// Staged, unregistered Deepgram native speech (TTS) adapter and bounded model
// discovery (#2034). Nothing in production imports this module yet;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createDeepgramTtsAdapter } from "./tts.js";

export * from "./config.js";
export { deepgramAcceptedJob } from "./http.js";
export { buildDeepgramSpeechRequest, createDeepgramTtsAdapter, isMp3, resolveDeepgramContainer } from "./tts.js";
export { groupDeepgramVoices, listDeepgramTtsModels, parseDeepgramTtsModels } from "./discovery.js";

/** Default instance: TTS_ADAPTERS under `deepgram` (and `dg`). */
export const deepgramTtsAdapter = createDeepgramTtsAdapter();
