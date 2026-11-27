// RenderHour text-to-speech: submit, bounded poll, then the finished file's
// bytes. Registered in TTS_ADAPTERS for /v1/audio/speech. See
// docs/providers/renderhour.md.
//
// Ported from cheaper-inference/OmniRoute at
// 9671192011beb2d7f83979f40be488c5da8772b9 (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza): open-sse/handlers/renderhourSpeech.ts.
// The job client is ../../services/renderhour/media.js.
//
// The OpenAI `input` becomes the job's `text`. RenderHour picks each model's
// voice, so `voice` and `response_format` are not sent: the audio comes back in
// whatever container RenderHour produced, so a named container is refused
// before submit (only `json`, the base64 wrapper, is accepted). Fork
// deviations: an `rh_` API key or a stored plan sign-in, a `model/voice` id is refused instead of sent, fixed poll bounds, and
// the file is downloaded without the key, only from a RenderHour host, without
// following redirects and within a size bound.
import { Buffer } from "node:buffer";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { RENDERHOUR_SPEECH_MODEL_IDS } from "../../providers/registry/renderhour.js";
import { assertRenderHourTask, downloadRenderHourFile, runRenderHourMediaJob } from "../../services/renderhour/media.js";
import { RENDERHOUR_MAX_MEDIA_OUTPUTS, RENDERHOUR_REQUEST_TIMEOUT_MS } from "../../services/renderhour/job.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

const FORMAT = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/ogg": "ogg", "audio/opus": "opus", "audio/aac": "aac", "audio/flac": "flac", "audio/mp4": "mp4",
  "audio/webm": "webm",
};

const badRequest = (message) => createErrorResult(HTTP_STATUS.BAD_REQUEST, message);
// Formats this adapter can honor whatever container RenderHour produces: none
// named (raw audio, Content-Type names the real container) or the JSON wrapper.
export const RENDERHOUR_SPEECH_RESPONSE_FORMATS = Object.freeze(["json"]);

/**
 * @param {object} [options] - submit, download and poll bounds and clock, for tests; see awaitRenderHourJob
 */
export function createRenderHourTtsAdapter({
  submitTimeoutMs = RENDERHOUR_REQUEST_TIMEOUT_MS,
  downloadTimeoutMs,
  maxAudioBytes,
  ...polling
} = {}) {
  return {
    async: true,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format }` on success, or a
     * full error result, which carries `acceptedJob` when the job may bill.
     */
    async synthesize(text, model, credentials, _responseFormat, options = {}) {
      const { signal, log } = options;
      if (isString(model) && RENDERHOUR_SPEECH_MODEL_IDS.some((id) => model.startsWith(`${id}/`))) {
        return badRequest("RenderHour picks the voice of each speech model; send the model id alone");
      }
      try {
        assertRenderHourTask("speech", model, options);
      } catch (error) {
        return createErrorResult(error.status, error.message);
      }
      const requested = options.requestedResponseFormat ?? options.response_format ?? null;
      if (requested != null && !RENDERHOUR_SPEECH_RESPONSE_FORMATS.includes(requested)) {
        return badRequest("RenderHour chooses the audio container; omit response_format for raw audio or use json");
      }
      const input = isString(text) ? text.trim() : "";
      if (!input) return badRequest("RenderHour speech needs input text");

      const result = await runRenderHourMediaJob({
        task: "speech",
        request: { model, text: input },
        credentials,
        signal,
        log,
        count: RENDERHOUR_MAX_MEDIA_OUTPUTS,
        submitTimeoutMs,
        polling,
      });
      if (!result.success) return result;
      // The source plays the first file; so does this adapter.
      const [file] = result.files;
      const downloaded = await downloadRenderHourFile(file, "speech", {
        credentials,
        signal,
        ...(downloadTimeoutMs ? { timeoutMs: downloadTimeoutMs } : null),
        ...(maxAudioBytes ? { maxBytes: maxAudioBytes } : null),
      });
      if (!downloaded.success) return downloaded;
      return {
        base64: Buffer.from(downloaded.bytes).toString("base64"),
        format: FORMAT[file.contentType],
        accounting: { ...result.accounting, meta: { ...result.accounting.meta, nativeUnitsSource: "input-characters" } },
      };
    },
  };
}

export default createRenderHourTtsAdapter();
