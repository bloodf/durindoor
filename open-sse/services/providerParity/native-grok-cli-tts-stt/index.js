// Staged, unregistered Grok CLI (Grok Build OAuth) native speech and
// transcription adapters (#2034). Nothing in production imports this module
// yet; ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createGrokCliSttAdapter } from "./stt.js";
import { createGrokCliTtsAdapter } from "./tts.js";

export * from "./config.js";
export { grokAcceptedJob, grokOAuthToken, grokRefusal } from "./http.js";
export { buildGrokSpeechRequest, createGrokCliTtsAdapter, matchesGrokCodec } from "./tts.js";
export { buildGrokTranscriptionRequest, createGrokCliSttAdapter, grokUploadFileName } from "./stt.js";

/** Default instance: a `grok-cli` entry for getTtsAdapter in ttsProviders/index.js. */
export const grokCliTtsAdapter = createGrokCliTtsAdapter();
/** Default instance: a `grok-cli` branch ahead of handleSttCore's format switch. */
export const grokCliSttAdapter = createGrokCliSttAdapter();
