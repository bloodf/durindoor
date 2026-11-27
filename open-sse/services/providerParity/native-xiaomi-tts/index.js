// Staged, unregistered Xiaomi MiMo native speech (TTS) adapter (#2034). Nothing
// in production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createXiaomiMimoTtsAdapter } from "./tts.js";

export * from "./config.js";
export { xiaomiMimoAcceptedJob } from "./http.js";
export {
  XIAOMI_MIMO_SPEECH_RESPONSE_FORMATS, buildXiaomiMimoSpeechRequest, createXiaomiMimoTtsAdapter, discoverXiaomiMimoTtsModels,
  isMp3, isWav, isXiaomiMimoTtsModelId, normalizeXiaomiMimoRequestFormat, xiaomiMimoAudioData,
} from "./tts.js";

/** Default instance: TTS_ADAPTERS under `xiaomi-mimo` (and its mimo / mimo-desktop / xmd aliases). */
export const xiaomiMimoTtsAdapter = createXiaomiMimoTtsAdapter();
