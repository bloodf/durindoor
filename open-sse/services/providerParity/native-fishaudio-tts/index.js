// Staged, unregistered Fish Audio native speech (TTS) adapter and voice
// discovery (#2034). Nothing in production imports this module yet;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createFishAudioTtsAdapter } from "./tts.js";
import { createFishAudioVoiceLister } from "./voices.js";

export * from "./config.js";
export { fishAudioAcceptedJob } from "./http.js";
export {
  FISH_AUDIO_OPTION_KEYS, FISH_AUDIO_SAFE_ID, buildFishAudioSpeechRequest, createFishAudioTtsAdapter,
  isMp3, isSafeFishAudioId, matchesContainer, resolveFishAudioContainer, resolveFishAudioModel,
} from "./tts.js";
export { FISH_AUDIO_VOICE_QUERY_KEYS, buildFishAudioVoicesUrl, createFishAudioVoiceLister, normalizeFishAudioVoices } from "./voices.js";

/** Default instance: TTS_ADAPTERS under `fish-audio` (and its `fish`, `fishaudio` aliases). */
export const fishAudioTtsAdapter = createFishAudioTtsAdapter();
/** Default voice lister: (credentials, query, { signal }) for a voices route. */
export const listFishAudioVoices = createFishAudioVoiceLister();
