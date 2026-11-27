// Vertex AI Gemini text-to-speech, staged as a TTS_ADAPTERS-shaped adapter
// (handlers/ttsCore.js contract: `synthesize(text, model, credentials,
// responseFormat, options)` → `{ base64, format, accounting }` or an error
// result, with `acceptedJob` when the call may have billed). Unregistered.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/executors/vertexMedia.ts: vertexGenerateSpeech (body
//   `contents[0] = { role: "user", parts: [{ text, speech_metadata?: { style } }] }`,
//   `generationConfig.responseModalities: ["AUDIO"]`,
//   `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`, default "Kore"),
//   buildGeminiSpeechStyle, extractSpeechInstruction, extractInlineAudio,
//   pcmToWav, parsePcmSampleRate, stripC2paMetadata, normalizeAudioOutput;
// - open-sse/handlers/audioSpeech.ts: the `vertex-gemini-tts` branch and
//   googleSpeechStyleOptions (instructions, speed, response_format).
//
// Fork deviations, all refusals before anything is sent unless noted:
// - only the five source model ids; voices must be one of the Gemini prebuilt
//   voices the local Gemini adapter lists (fetchGeminiVoices);
// - mp3/opus/aac/flac and streaming are refused instead of answered as WAV;
// - `language` is refused (the source's Vertex path drops it silently);
// - speed must be 0.25–4, style/input lengths are bounded;
// - an answer without audio, with a non-PCM/WAV MIME type, a bad sample rate
//   or malformed base64 is an error carrying `acceptedJob` (it may have billed).
import { Buffer } from "node:buffer";
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { fetchGeminiVoices } from "../../../handlers/ttsProviders/gemini.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  VERTEX_AUDIO_REQUEST_TIMEOUT_MS, VERTEX_TTS_DEFAULT_VOICE, VERTEX_TTS_MAX_INPUT_CHARS, VERTEX_TTS_MAX_RESPONSE_BYTES,
  VERTEX_TTS_MAX_STYLE_CHARS, VERTEX_TTS_MODEL_IDS, VERTEX_TTS_RESPONSE_FORMATS,
} from "./config.js";
import { resolveVertexAudioAuth, vertexGenerateContentRequest } from "./auth.js";
import { sendVertexGenerateContent, vertexAbortedResult, vertexUnusableResult } from "./request.js";

const badRequest = (message) => createErrorResult(HTTP_STATUS.BAD_REQUEST, message);
const STYLE_KEYS = ["instructions", "style", "delivery", "prompt"];
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const PCM_MIME_RE = /^audio\/(l16|pcm)(;|$)/i;
const WAV_MIME_RE = /^audio\/(wav|x-wav|wave)(;|$)/i;

/** Gemini prebuilt voice ids (the same list the local Gemini adapter serves). */
export async function listVertexTtsVoices() {
  return fetchGeminiVoices();
}

/** Source extractSpeechInstruction: first nonempty of instructions/style/delivery/prompt. */
export function extractSpeechInstruction(body) {
  for (const key of STYLE_KEYS) {
    const value = body?.[key];
    if (isString(value) && value.trim()) return value.trim();
  }
  return undefined;
}

/** Source buildGeminiSpeechStyle. */
export function buildGeminiSpeechStyle(instructions, speed) {
  const parts = [];
  if (instructions && instructions.trim()) parts.push(instructions.trim());
  if (isNumber(speed) && speed > 0 && Math.abs(speed - 1.0) > 0.05) parts.push(`Pace: ${speed}x normal speed`);
  return parts.length ? parts.join(". ") : undefined;
}

/** Source pcmToWav: 44-byte RIFF header around little-endian 16-bit mono PCM. */
export function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Source parsePcmSampleRate, bounded: null when the MIME names an implausible rate. */
export function parsePcmSampleRate(mimeType) {
  const match = /rate=(\d+)/i.exec(mimeType || "");
  if (!match) return 24000;
  const rate = Number.parseInt(match[1], 10);
  return rate >= 8000 && rate <= 48000 ? rate : null;
}

const isRiffWave = (b) => b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WAVE";
const C2PA_RIFF_TAGS = new Set(["C2PA", "jumb", "c2pa"]);

// Walk RIFF chunk headers; null when the chunk table is malformed.
function riffChunks(buffer) {
  const chunks = [];
  let pos = 12;
  while (pos + 8 <= buffer.length) {
    const tag = buffer.subarray(pos, pos + 4).toString("ascii");
    const size = buffer.readUInt32LE(pos + 4);
    chunks.push({ tag, start: pos, dataStart: pos + 8, dataEnd: Math.min(pos + 8 + size, buffer.length) });
    pos += 8 + size + (size & 1);
  }
  return chunks;
}

/** Source stripC2paMetadata (RIFF branch): cut trailers after the `data` chunk. */
export function stripC2paMetadata(buffer) {
  if (!isRiffWave(buffer)) return buffer;
  const chunks = riffChunks(buffer);
  const dataIndex = chunks.findIndex((c) => c.tag === "data");
  if (dataIndex === -1) return buffer;
  const trailer = chunks.slice(dataIndex + 1).find((c) => C2PA_RIFF_TAGS.has(c.tag));
  if (trailer) return buffer.subarray(0, trailer.start);
  const data = chunks[dataIndex];
  return data.dataEnd < buffer.length ? buffer.subarray(0, data.dataEnd) : buffer;
}

/**
 * Source normalizeAudioOutput: a clean WAV, or raw PCM for `pcm`.
 * Throws on malformed audio; the caller turns that into an unusable result.
 */
export function normalizeVertexAudio(raw, mimeType, responseFormat) {
  if (!raw.length) throw new Error("empty audio");
  if (WAV_MIME_RE.test(mimeType) || isRiffWave(raw)) {
    if (!isRiffWave(raw)) throw new Error("WAV MIME without a RIFF header");
    const clean = stripC2paMetadata(raw);
    const fmt = riffChunks(clean).find((c) => c.tag === "fmt ");
    const data = riffChunks(clean).find((c) => c.tag === "data");
    if (!fmt || !data || data.dataEnd <= data.dataStart) throw new Error("WAV without fmt/data chunks");
    if (responseFormat === "pcm") return { audio: clean.subarray(data.dataStart, data.dataEnd), format: "pcm" };
    const wav = Buffer.from(clean);
    wav.writeUInt32LE(wav.length - 8, 4);
    return { audio: wav, format: "wav" };
  }
  if (!PCM_MIME_RE.test(mimeType)) throw new Error("unsupported audio MIME type");
  const rate = parsePcmSampleRate(mimeType);
  if (rate === null) throw new Error("implausible PCM sample rate");
  if (raw.length % 2 !== 0) throw new Error("odd-length 16-bit PCM");
  if (responseFormat === "pcm") return { audio: raw, format: "pcm" };
  return { audio: pcmToWav(raw, rate), format: "wav" };
}

/** Provider-reported token counts only; invalid counts are dropped, the receipt kept. */
export function vertexUsageAccounting(data) {
  const usage = isRecord(data?.usageMetadata) ? data.usageMetadata : null;
  const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : undefined);
  const tokens = {};
  if (usage) {
    const input = count(usage.promptTokenCount);
    const candidates = count(usage.candidatesTokenCount);
    const thoughts = count(usage.thoughtsTokenCount);
    const total = count(usage.totalTokenCount);
    if (input !== undefined) tokens.input_tokens = input;
    if (candidates !== undefined) tokens.output_tokens = candidates + (thoughts ?? 0);
    if (thoughts !== undefined && candidates !== undefined) tokens.reasoning_tokens = thoughts;
    if (total !== undefined && input !== undefined && tokens.output_tokens !== undefined && total === input + tokens.output_tokens) tokens.total_tokens = total;
  }
  const receipt = {};
  if (usage) receipt.usageMetadata = usage;
  if (isString(data?.responseId)) receipt.responseId = data.responseId;
  if (isString(data?.modelVersion)) receipt.modelVersion = data.modelVersion;
  return { tokens, nativeUnits: {}, ...(Object.keys(receipt).length ? { meta: { providerReceipt: receipt } } : null) };
}

function firstInlineAudio(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const inline = part?.inlineData;
    if (isRecord(inline) && isString(inline.data) && inline.data.length) {
      return { base64: inline.data, mimeType: isString(inline.mimeType) ? inline.mimeType : "audio/L16;rate=24000" };
    }
  }
  return null;
}

/** `model` or `model/voice`; the voice may also come from the body. */
async function parseModelVoice(model, bodyVoice) {
  const text = isString(model) ? model.trim() : "";
  const modelId = VERTEX_TTS_MODEL_IDS.find((id) => text === id || text.startsWith(`${id}/`));
  if (!modelId) throw badRequest(`Vertex TTS model must be one of: ${VERTEX_TTS_MODEL_IDS.join(", ")}`);
  const fromModel = text.length > modelId.length ? text.slice(modelId.length + 1) : null;
  const fromBody = isString(bodyVoice) && bodyVoice.trim() ? bodyVoice.trim() : null;
  if (bodyVoice != null && !isString(bodyVoice)) throw badRequest("Vertex TTS voice must be a string");
  if (fromModel && fromBody && fromModel.toLowerCase() !== fromBody.toLowerCase()) throw badRequest("Vertex TTS voice differs between model and voice fields");
  const wanted = fromModel || fromBody || VERTEX_TTS_DEFAULT_VOICE;
  const voices = (await listVertexTtsVoices()).map((v) => v.voice_id);
  const voice = voices.find((id) => id.toLowerCase() === wanted.toLowerCase());
  if (!voice) throw badRequest("Vertex TTS voice must be a Gemini prebuilt voice");
  return { modelId, voice };
}

/** The format the client asked for; `mp3` is the route's default when none is named. */
function requestedFormat(responseFormat, options) {
  const named = options.requestedResponseFormat ?? options.response_format ?? null;
  if (named != null) return isString(named) ? named.trim().toLowerCase() : "";
  return !responseFormat || responseFormat === "mp3" ? "wav" : String(responseFormat).toLowerCase();
}

/**
 * Build the source request body after refusing everything it cannot honor.
 * Throws an error result (status 400) on refusal.
 */
export async function buildVertexSpeechRequest(text, model, responseFormat = "mp3", options = {}) {
  const input = isString(text) ? text.trim() : "";
  if (!input) throw badRequest("Vertex TTS needs input text");
  if ([...input].length > VERTEX_TTS_MAX_INPUT_CHARS) throw badRequest(`Vertex TTS input is limited to ${VERTEX_TTS_MAX_INPUT_CHARS} characters`);
  const format = requestedFormat(responseFormat, options);
  if (!VERTEX_TTS_RESPONSE_FORMATS.includes(format)) throw badRequest(`Vertex TTS response_format must be one of: ${VERTEX_TTS_RESPONSE_FORMATS.join(", ")}`);
  if (options.stream === true || (options.stream_format != null && options.stream_format !== "audio")) throw badRequest("Vertex TTS does not stream audio");
  if (options.language != null && options.language !== "") throw badRequest("Vertex TTS does not take language; Gemini reads it from the input");
  const speed = options.speed;
  if (speed != null && (!isNumber(speed) || !Number.isFinite(speed) || speed < 0.25 || speed > 4)) throw badRequest("Vertex TTS speed must be a number from 0.25 to 4");
  for (const key of STYLE_KEYS) {
    if (options[key] != null && !isString(options[key])) throw badRequest(`Vertex TTS ${key} must be a string`);
  }
  const instructions = extractSpeechInstruction(options);
  if (instructions && instructions.length > VERTEX_TTS_MAX_STYLE_CHARS) throw badRequest(`Vertex TTS instructions are limited to ${VERTEX_TTS_MAX_STYLE_CHARS} characters`);
  const { modelId, voice } = await parseModelVoice(model, options.voice);
  const style = buildGeminiSpeechStyle(instructions, speed);
  const part = { text: input };
  if (style) part.speech_metadata = { style };
  return {
    modelId,
    voice,
    format,
    body: {
      contents: [{ role: "user", parts: [part] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    },
  };
}

/**
 * @param {object} [deps] - injectable token minting and bounds, for tests
 */
export function createVertexTtsAdapter({
  requestTimeoutMs = VERTEX_AUDIO_REQUEST_TIMEOUT_MS,
  maxResponseBytes = VERTEX_TTS_MAX_RESPONSE_BYTES,
  ...authDeps
} = {}) {
  return {
    format: "vertex-gemini-tts",
    async synthesize(text, model, credentials, responseFormat, options = {}) {
      const { signal, log } = options;
      let built;
      try {
        built = await buildVertexSpeechRequest(text, model, responseFormat, options);
      } catch (error) {
        if (error?.success === false) return error;
        throw error;
      }
      if (signal?.aborted) return vertexAbortedResult();
      const proxyOptions = options.proxyOptions ?? resolveCredentialProxyOptions(credentials);
      const startedAt = Date.now();
      const auth = await resolveVertexAudioAuth(credentials, { signal, log, proxyOptions, ...authDeps });
      if (!auth.ok) return auth.status === 499 ? vertexAbortedResult() : createErrorResult(auth.status, auth.message, undefined, undefined, null, credentials);
      const result = await sendVertexGenerateContent({
        request: vertexGenerateContentRequest(auth, built.modelId),
        body: built.body,
        signal,
        timeoutMs: Math.max(1, requestTimeoutMs - (Date.now() - startedAt)),
        maxResponseBytes,
        proxyOptions,
        label: "speech",
        modality: "tts",
        secrets: { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken, token: auth.token },
      });
      if (!result.ok) return result;
      const { data } = result;
      const inline = firstInlineAudio(data);
      if (!inline) {
        const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
        const safe = isString(reason) && /^[A-Z_]{1,64}$/.test(reason) ? ` (${reason})` : "";
        return vertexUnusableResult(`Vertex TTS returned no audio${safe}`, "tts", data);
      }
      if (inline.base64.length % 4 === 1 || !BASE64_RE.test(inline.base64)) return vertexUnusableResult("Vertex TTS returned malformed audio", "tts", data);
      let normalized;
      try {
        normalized = normalizeVertexAudio(Buffer.from(inline.base64, "base64"), inline.mimeType, built.format === "pcm" ? "pcm" : "wav");
      } catch {
        return vertexUnusableResult("Vertex TTS returned audio in an unsupported or malformed encoding", "tts", data);
      }
      return { base64: normalized.audio.toString("base64"), format: normalized.format, accounting: vertexUsageAccounting(data) };
    },
  };
}

export default createVertexTtsAdapter();
