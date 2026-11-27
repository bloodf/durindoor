// Staged, unregistered SYNTX.ai native media adapters (#1234, #2034):
// image generation and edits, video, speech, music and transcription.
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Upscale is owned by the separate
// native-image-upscale unit, which can reuse the auth, upload, job and
// download exports below. Source attribution is in ./config.js.
import {
  createSyntxImageAdapter, createSyntxMusicAdapter, createSyntxSttAdapter, createSyntxTtsAdapter, createSyntxVideoAdapter,
} from "./adapters.js";

export * from "./config.js";
export {
  extractSyntxToken, looksLikeJwt, resolveSyntxCredential, stripBearerPrefix, syntxApiHeaders, syntxSecretSource,
} from "./auth.js";
export { syntxAcceptedJob } from "./http.js";
export { assertSyntxUrlResolvesPublic, downloadSyntxMedia, sniffAudioFormat, syntxPublicUrl } from "./download.js";
export {
  collectSyntxCompletedMedia, createSyntxChat, extractSyntxImmediateUrls, latestSyntxAssistantMessage, runSyntxMediaJob,
  syntxChatTitle, syntxPollTimeout, uploadSyntxReference,
} from "./job.js";
export {
  applySyntxProviderRules, mapSyntxAudioSettings, mapSyntxImageSettings, mapSyntxVideoSettings,
} from "./providerOptions.js";
export {
  SYNTX_MEDIA_RESPONSE_FORMATS, SYNTX_MISSING_JWT, SYNTX_SPEECH_RESPONSE_FORMATS, SYNTX_TRANSCRIPTION_RESPONSE_FORMATS,
  buildSyntxImageRequest, buildSyntxMusicRequest, buildSyntxVideoRequest, createSyntxImageAdapter, createSyntxMusicAdapter,
  createSyntxSttAdapter, createSyntxTtsAdapter, createSyntxVideoAdapter, decodeSyntxDataUrl, syntxTranscriptText,
} from "./adapters.js";

/** Default instances for the registration step. */
export const syntxImageAdapter = createSyntxImageAdapter();
export const syntxVideoAdapter = createSyntxVideoAdapter();
export const syntxTtsAdapter = createSyntxTtsAdapter();
export const syntxMusicAdapter = createSyntxMusicAdapter();
export const syntxSttAdapter = createSyntxSttAdapter();
