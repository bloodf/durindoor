// Staged, unregistered Qwen Cloud Token Plan (DashScope SpeechSynthesizer)
// native speech (TTS) adapter (#2034). Nothing in production imports this
// module yet; ./registration.json describes the serial registration step.
// Source attribution is in ./config.js.
import { createDashscopeTtsAdapter } from "./tts.js";

export * from "./config.js";
export { dashscopeTtsAcceptedJob } from "./http.js";
export {
  DASHSCOPE_TTS_RESPONSE_FORMATS, buildDashscopeTtsRequest, createDashscopeTtsAdapter, dashscopeTtsAccounting,
  dashscopeTtsRegionSupported, downloadDashscopeTtsAudio, isMp3, normalizeDashscopeTtsFormat,
} from "./tts.js";

/** Default instance: TTS_ADAPTERS under `qwen-cloud-token-plan` (alias qct resolves through the registry). */
export const dashscopeTtsAdapter = createDashscopeTtsAdapter();
