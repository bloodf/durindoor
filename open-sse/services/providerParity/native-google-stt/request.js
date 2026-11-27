// Request side of the staged Gemini Live transcription: input checks, PCM
// extraction and the source's wire frames. See ./config.js for attribution.
//
// Source frames (geminiLiveTranscribe.ts buildLiveSetupMessage /
// streamAudio / endAudioStream):
//   { setup: { model: "models/<id>", generationConfig: { responseModalities: ["TEXT"] },
//              inputAudioTranscription: { languageCodes: [<language>] | [] },
//              systemInstruction?: { parts: [{ text: <prompt> }] } } }
//   { realtimeInput: { audio: { data: <base64 PCM>, mimeType: "audio/pcm;rate=16000" } } }   (3200-byte chunks)
//   { realtimeInput: { audioStreamEnd: true } }
//
// Fork deviation: the source pipes any other container through ffmpeg; this
// staged adapter spawns no process and accepts only what the source's
// no-ffmpeg path accepts (a RIFF/WAVE file whose fmt chunk is PCM, mono,
// 16 kHz, 16-bit). Everything else, and every field the source silently
// dropped, is refused before a socket is opened.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { createErrorResult } from "../../../utils/error.js";
import { isFunction, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GEMINI_LIVE_MAX_INPUT_BYTES, GEMINI_LIVE_MAX_PCM_BYTES, GEMINI_LIVE_MAX_TEXT_FIELD, GEMINI_LIVE_PCM_CHUNK_BYTES,
  GEMINI_LIVE_PCM_MIME, GEMINI_LIVE_STT_MODELS, geminiLiveSttModel,
} from "./config.js";

export const GEMINI_LIVE_RESPONSE_FORMATS = Object.freeze(["json"]);
/** Fields the source dropped without honoring; refused here instead of silently ignored. */
export const GEMINI_LIVE_REFUSED_FIELDS = Object.freeze([
  "timestamp_granularities", "timestamp_granularities[]", "temperature", "diarization", "diarization_mode",
  "custom_vocabulary", "mode", "chunking_strategy", "include[]", "include",
]);
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

/** A caller input error: never the account's fault, nothing was sent. */
export const invalid = (message, status = HTTP_STATUS.BAD_REQUEST) => ({ ...createErrorResult(status, message), local: true });

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const present = (value) => value !== null && value !== undefined && value !== "";

/**
 * Raw PCM samples of a 16 kHz, 16-bit, mono PCM WAV, or null. Port of the
 * source extractPcmFrom16kWav (fmt chunk before data, 2-byte chunk padding,
 * a data chunk that overruns the file is cut at its end).
 */
export function extractPcmFrom16kWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let isPcm16k = false;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || data + 16 > buffer.length) return null;
      if (buffer.readUInt16LE(data) !== 1 || buffer.readUInt16LE(data + 2) !== 1 ||
        buffer.readUInt32LE(data + 4) !== 16000 || buffer.readUInt16LE(data + 14) !== 16) return null;
      isPcm16k = true;
    } else if (id === "data" && isPcm16k) {
      return buffer.subarray(data, Math.min(data + size, buffer.length));
    }
    offset = data + size + (size % 2);
  }
  return null;
}

/** Source buildLiveSetupMessage. */
export function buildGeminiLiveSetupFrame({ model, language = null, prompt = null }) {
  const setup = {
    model: model.startsWith("models/") ? model : `models/${model}`,
    generationConfig: { responseModalities: ["TEXT"] },
    inputAudioTranscription: { languageCodes: language ? [language] : [] },
  };
  if (prompt) setup.systemInstruction = { parts: [{ text: prompt }] };
  return { setup };
}

/** Source streamAudio: 100 ms chunks as base64 realtimeInput.audio frames, built lazily. */
export function* geminiLiveAudioFrames(pcm, chunkBytes = GEMINI_LIVE_PCM_CHUNK_BYTES) {
  for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
    const chunk = pcm.subarray(offset, Math.min(offset + chunkBytes, pcm.length));
    yield { realtimeInput: { audio: { data: chunk.toString("base64"), mimeType: GEMINI_LIVE_PCM_MIME } } };
  }
}

export const GEMINI_LIVE_AUDIO_END_FRAME = Object.freeze({ realtimeInput: Object.freeze({ audioStreamEnd: true }) });

function optionalText(formData, name) {
  const value = field(formData, name);
  if (!present(value)) return { value: null };
  if (!isString(value)) return { error: `Gemini Live transcription ${name} must be text` };
  const trimmed = value.trim();
  if (trimmed.length > GEMINI_LIVE_MAX_TEXT_FIELD) return { error: `Gemini Live transcription ${name} is too long` };
  return { value: trimmed || null };
}

/**
 * Check a transcription request and build the session plan. Every refusal
 * here happens before any socket is opened.
 *
 * @returns {Promise<{ plan: { model, setup, pcm, audioSeconds, language } } | object>}
 */
export async function buildGeminiLiveTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("Gemini Live audio translations are not supported");
  const entry = geminiLiveSttModel(model);
  if (!entry) return invalid(`Unsupported Gemini Live transcription model: ${model}. Use one of: ${GEMINI_LIVE_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(present(field(formData, "url")) ? "Gemini Live transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (present(stream) && String(stream).toLowerCase() !== "false") return invalid("Gemini Live file transcription does not stream; use /v1/realtime/native for live sessions");
  const format = field(formData, "response_format");
  if (present(format) && String(format).trim().toLowerCase() !== "json") {
    return invalid(`Gemini Live transcription supports response_format ${GEMINI_LIVE_RESPONSE_FORMATS.join(", ")}`);
  }
  const refused = GEMINI_LIVE_REFUSED_FIELDS.find((name) => present(field(formData, name)));
  if (refused) return invalid(`Gemini Live transcription does not support ${refused}`);

  const language = optionalText(formData, "language");
  if (language.error) return invalid(language.error);
  if (language.value !== null && !LANGUAGE.test(language.value)) return invalid("Gemini Live transcription language must be a BCP-47 code such as en or en-US");
  const prompt = optionalText(formData, "prompt");
  if (prompt.error) return invalid(prompt.error);

  if (Number.isFinite(file.size) && file.size > GEMINI_LIVE_MAX_INPUT_BYTES) return invalid("Audio file is too large for Gemini Live transcription", 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("Gemini Live transcription file is empty");
  if (bytes.length > GEMINI_LIVE_MAX_INPUT_BYTES) return invalid("Audio file is too large for Gemini Live transcription", 413);
  const pcm = extractPcmFrom16kWav(bytes);
  if (!pcm) {
    return invalid("Gemini Live transcription accepts only 16 kHz, 16-bit, mono PCM WAV audio; other formats need conversion first", 415);
  }
  if (pcm.length === 0) return invalid("Gemini Live transcription file has no audio samples");
  if (pcm.length > GEMINI_LIVE_MAX_PCM_BYTES) return invalid("Audio exceeds the maximum duration for Gemini Live transcription", 413);

  return {
    plan: {
      model: entry.id,
      setup: buildGeminiLiveSetupFrame({ model: entry.id, language: language.value, prompt: prompt.value }),
      pcm,
      audioSeconds: pcm.length / 32_000,
      language: language.value,
    },
  };
}
