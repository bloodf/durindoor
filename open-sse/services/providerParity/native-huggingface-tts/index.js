// Staged, unregistered HuggingFace native speech (TTS) adapter (#2034). Nothing
// in production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createHuggingFaceTtsAdapter } from "./tts.js";

export * from "./config.js";
export { huggingfaceAcceptedJob } from "./http.js";
export {
  HUGGINGFACE_SPEECH_CONTAINERS, HUGGINGFACE_SPEECH_RESPONSE_FORMATS, buildHuggingFaceSpeechRequest,
  createHuggingFaceTtsAdapter, sniffAudioContainer,
} from "./tts.js";

/** Default instance: TTS_ADAPTERS under `huggingface` (and its `hf` alias). */
export const huggingfaceTtsAdapter = createHuggingFaceTtsAdapter();
