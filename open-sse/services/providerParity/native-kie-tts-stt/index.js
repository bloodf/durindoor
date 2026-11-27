// Staged, unregistered Kie native speech (TTS) and transcription (STT)
// adapters (#2034). Nothing in production imports this module yet;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createKieSttAdapter } from "./stt.js";
import { createKieTtsAdapter } from "./tts.js";

export * from "./config.js";
export { kieAcceptedJob } from "./http.js";
export { normalizeKieTaskState, parseKieResultJson, runKieTask } from "./task.js";
export {
  KIE_SPEECH_RESPONSE_FORMATS, buildKieSpeechRequest, createKieTtsAdapter, downloadKieAudio, findKieAudioUrl,
  kiePublicUrl, normalizeKieVoice, sniffAudioFormat,
} from "./tts.js";
export {
  KIE_TRANSCRIPTION_RESPONSE_FORMATS, buildKieTranscriptionRequest, createKieSttAdapter, kieTranscriptText, kieUploadFileName,
} from "./stt.js";

/** Default instances: TTS_ADAPTERS under `kie`, and the `kie-audio` branch of handleSttCore. */
export const kieTtsAdapter = createKieTtsAdapter();
export const kieSttAdapter = createKieSttAdapter();
