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

/** Pinned Singapore instance (the first staging contract) for `qwen-cloud-token-plan`. */
export const dashscopeTtsAdapter = createDashscopeTtsAdapter();

/**
 * Region-parity instance (#2034): the connection's source region (global-sg or
 * china-beijing) selects this identity's fixed SpeechSynthesizer host. This is
 * what the serial registration step wires into TTS_ADAPTERS.
 */
export const dashscopeRegionalTtsAdapter = createDashscopeTtsAdapter({ regional: true });
