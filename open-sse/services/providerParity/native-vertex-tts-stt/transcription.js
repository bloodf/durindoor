// Vertex AI Gemini transcription, staged for handlers/sttCore.js (result shape
// of handleSttCore: `{ success, response, usageValue, nativeUnits }` or an
// error result, with `acceptedJob` when the call may have billed). Unregistered.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/executors/vertexMedia.ts: vertexTranscribe (body
//   `contents[0] = { role: "user", parts: [{ text: instruction },
//   { inlineData: { mimeType, data } }] }`, the default instruction
//   "Transcribe this audio verbatim. Output only the spoken words (language: X),
//   with no commentary.", the answer as the joined, trimmed candidate text);
// - open-sse/handlers/audioTranscription.ts: the `vertex-gemini` branch
//   (file bytes as base64, `language` and `prompt` form fields, `{ text }` JSON).
//
// Fork deviations, all refusals before anything is sent unless noted:
// - only the three source model ids; translations are refused;
// - form fields other than file/model/language/prompt/response_format are
//   refused (temperature, timestamps, streaming, include[] have no Vertex
//   equivalent here); response_format is json or text only;
// - `prompt` together with `language` is refused (the source drops language);
// - the audio MIME type must be a Gemini audio type, the file nonempty and at
//   most VERTEX_STT_MAX_AUDIO_BYTES;
// - an answer without candidates or with a non-text candidate is an error with
//   `acceptedJob` (it may have billed); duration is never inferred.
import { Buffer } from "node:buffer";
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  VERTEX_AUDIO_REQUEST_TIMEOUT_MS, VERTEX_STT_AUDIO_MIME_TYPES, VERTEX_STT_MAX_AUDIO_BYTES, VERTEX_STT_MAX_PROMPT_CHARS,
  VERTEX_STT_MAX_RESPONSE_BYTES, VERTEX_STT_MODEL_IDS, VERTEX_STT_RESPONSE_FORMATS,
} from "./config.js";
import { resolveVertexAudioAuth, vertexGenerateContentRequest } from "./auth.js";
import { sendVertexGenerateContent, vertexAbortedResult, vertexUnusableResult } from "./request.js";

const badRequest = (message) => createErrorResult(HTTP_STATUS.BAD_REQUEST, message);
const ALLOWED_FIELDS = new Set(["file", "model", "language", "prompt", "response_format"]);
const LANGUAGE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const EXTENSION_MIME = {
  wav: "audio/wav", mp3: "audio/mpeg", aiff: "audio/aiff", aif: "audio/aiff", aac: "audio/aac", ogg: "audio/ogg",
  oga: "audio/ogg", flac: "audio/flac", webm: "audio/webm", mp4: "audio/mp4", m4a: "audio/mp4",
};
const MIME_ALIASES = { "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/x-m4a": "audio/m4a", "audio/x-flac": "audio/flac", "audio/x-aiff": "audio/aiff" };

/** Source default instruction. */
export function vertexTranscriptionInstruction(language) {
  return `Transcribe this audio verbatim. Output only the spoken words${language ? ` (language: ${language})` : ""}, with no commentary.`;
}

/** The upload's audio MIME type, from its type or extension; null when not a Gemini audio type. */
export function resolveVertexAudioMime(file) {
  const raw = isString(file?.type) ? file.type.split(";")[0].trim().toLowerCase() : "";
  let mime = MIME_ALIASES[raw] || raw;
  if (!mime || mime === "application/octet-stream") {
    const name = isString(file?.name) ? file.name.toLowerCase() : "";
    const ext = name.includes(".") ? name.split(".").pop() : "";
    mime = EXTENSION_MIME[ext] || "";
  }
  return VERTEX_STT_AUDIO_MIME_TYPES.includes(mime) ? mime : null;
}

const field = (formData, name) => {
  const values = formData.getAll(name);
  if (values.length > 1) throw badRequest(`Vertex transcription takes one ${name}`);
  const value = values[0];
  if (value == null || value === "") return null;
  if (!isString(value)) throw badRequest(`Vertex transcription ${name} must be text`);
  return value.trim() || null;
};

/**
 * Validate the form and build the source request body. Throws an error result
 * (status 400/413) on refusal; reads the file bytes only after every check.
 */
export async function buildVertexTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") throw badRequest("Vertex transcription does not support audio translations");
  if (!VERTEX_STT_MODEL_IDS.includes(model)) throw badRequest(`Vertex transcription model must be one of: ${VERTEX_STT_MODEL_IDS.join(", ")}`);
  for (const name of new Set(formData.keys())) {
    if (!ALLOWED_FIELDS.has(name)) throw badRequest(`Vertex transcription does not support ${name}`);
  }
  const files = formData.getAll("file");
  if (files.length !== 1 || !files[0] || isString(files[0]) || typeof files[0].arrayBuffer !== "function") throw badRequest("Vertex transcription needs one audio file");
  const file = files[0];
  const language = field(formData, "language");
  const prompt = field(formData, "prompt");
  const responseFormat = (field(formData, "response_format") || "json").toLowerCase();
  if (!VERTEX_STT_RESPONSE_FORMATS.includes(responseFormat)) throw badRequest(`Vertex transcription response_format must be one of: ${VERTEX_STT_RESPONSE_FORMATS.join(", ")}`);
  if (language && !LANGUAGE_RE.test(language)) throw badRequest("Vertex transcription language must be a language tag such as en or pt-BR");
  if (language && prompt) throw badRequest("Vertex transcription takes language or prompt, not both");
  if (prompt && prompt.length > VERTEX_STT_MAX_PROMPT_CHARS) throw badRequest(`Vertex transcription prompt is limited to ${VERTEX_STT_MAX_PROMPT_CHARS} characters`);
  const mimeType = resolveVertexAudioMime(file);
  if (!mimeType) throw badRequest(`Vertex transcription audio must be one of: ${VERTEX_STT_AUDIO_MIME_TYPES.join(", ")}`);
  if (Number.isFinite(file.size) && file.size > VERTEX_STT_MAX_AUDIO_BYTES) throw createErrorResult(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Vertex transcription audio is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) throw badRequest("Vertex transcription audio is empty");
  if (bytes.length > VERTEX_STT_MAX_AUDIO_BYTES) throw createErrorResult(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Vertex transcription audio is too large");
  return {
    responseFormat,
    body: {
      contents: [{
        role: "user",
        parts: [
          { text: prompt || vertexTranscriptionInstruction(language) },
          { inlineData: { mimeType, data: bytes.toString("base64") } },
        ],
      }],
    },
  };
}

/** Source extractText, strict: null when no candidate carries text parts only. */
export function extractVertexTranscript(data) {
  const candidate = data?.candidates?.[0];
  if (!isRecord(candidate)) return null;
  const parts = candidate.content?.parts;
  if (parts == null) return candidate.finishReason === "STOP" ? "" : null;
  if (!Array.isArray(parts) || parts.some((p) => !isRecord(p) || !isString(p.text))) return null;
  return parts.map((p) => p.text).join("").trim();
}

function sttResult(text, data, responseFormat) {
  const usage = isRecord(data?.usageMetadata) ? data.usageMetadata : undefined;
  const response = responseFormat === "text"
    ? new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" } })
    : new Response(JSON.stringify({ text }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  return { success: true, usageValue: usage ? { usageMetadata: usage } : { usage: undefined }, nativeUnits: {}, response };
}

/**
 * @param {object} [deps] - injectable token minting and bounds, for tests
 */
export function createVertexSttTranscriber({
  requestTimeoutMs = VERTEX_AUDIO_REQUEST_TIMEOUT_MS,
  maxResponseBytes = VERTEX_STT_MAX_RESPONSE_BYTES,
  ...authDeps
} = {}) {
  /**
   * @param {{model: string, formData: FormData, credentials: object, kind?: string, signal?: AbortSignal, log?: object, proxyOptions?: object}} options
   */
  return async function transcribeVertex({ model, formData, credentials, kind = "transcription", signal, log, proxyOptions }) {
    let built;
    try {
      built = await buildVertexTranscriptionRequest(model, formData, { kind });
    } catch (error) {
      if (error?.success === false) return error;
      throw error;
    }
    if (signal?.aborted) return vertexAbortedResult();
    const egress = proxyOptions ?? resolveCredentialProxyOptions(credentials);
    const startedAt = Date.now();
    const auth = await resolveVertexAudioAuth(credentials, { signal, log, proxyOptions: egress, ...authDeps });
    if (!auth.ok) return auth.status === 499 ? vertexAbortedResult() : createErrorResult(auth.status, auth.message, undefined, undefined, null, credentials);
    const result = await sendVertexGenerateContent({
      request: vertexGenerateContentRequest(auth, model),
      body: built.body,
      signal,
      timeoutMs: Math.max(1, requestTimeoutMs - (Date.now() - startedAt)),
      maxResponseBytes,
      proxyOptions: egress,
      label: "transcription",
      modality: "stt",
      secrets: { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken, token: auth.token },
    });
    if (!result.ok) return result;
    const text = extractVertexTranscript(result.data);
    if (text === null) {
      const reason = result.data?.promptFeedback?.blockReason || result.data?.candidates?.[0]?.finishReason;
      const safe = isString(reason) && /^[A-Z_]{1,64}$/.test(reason) ? ` (${reason})` : "";
      return vertexUnusableResult(`Vertex transcription returned no transcript${safe}`, "stt", result.data);
    }
    return sttResult(text, result.data, built.responseFormat);
  };
}

export const transcribeVertex = createVertexSttTranscriber();
