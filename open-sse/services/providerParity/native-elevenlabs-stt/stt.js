// OmniRoute MIT port: 3a17f7e908308a217887a7617c2c793b95ea83c0,
// open-sse/handlers/audioTranscription.ts handleElevenLabsTranscription and
// open-sse/utils/audioMultipart.ts. Official response schema:
// https://elevenlabs.io/docs/api-reference/speech-to-text/convert
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { ELEVENLABS_PROVIDER_ID, ELEVENLABS_STT_MODELS, ELEVENLABS_TRANSCRIPTION_URL, ELEVENLABS_STT_TIMEOUT_MS, ELEVENLABS_MAX_STT_FILE_BYTES, ELEVENLABS_MAX_TRANSCRIPT_BYTES } from "./config.js";
import { discard, invalid, lostResult, elevenLabsToken, sendOnce, withAcceptedJob } from "./http.js";

export const ELEVENLABS_RESPONSE_FORMATS = Object.freeze(["json", "text", "verbose_json"]);
const allowed = new Set(["model", "file", "language", "response_format"]);
/** Validate the source-supported fields before producing a multipart request. */
export async function buildElevenLabsTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("ElevenLabs translation is not supported");
  if (!ELEVENLABS_STT_MODELS.some((entry) => entry.id === model)) return invalid("Unsupported ElevenLabs transcription model");
  if (!formData || typeof formData.entries !== "function") return invalid("Missing transcription form");
  for (const [key] of formData.entries()) if (!allowed.has(key)) return invalid(`Unsupported ElevenLabs transcription option: ${key}`);
  const format = formData.get("response_format") || "json";
  if (typeof format !== "string" || !ELEVENLABS_RESPONSE_FORMATS.includes(format)) return invalid("Unsupported ElevenLabs response format");
  const language = formData.get("language");
  if (language !== null && (typeof language !== "string" || (language && !/^[a-zA-Z]{2,3}$/.test(language)))) return invalid("Invalid ElevenLabs language");
  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return invalid("Missing required field: file");
  if (file.size > ELEVENLABS_MAX_STT_FILE_BYTES) return invalid("ElevenLabs transcription file is too large");
  let bytes;
  try { bytes = Buffer.from(await file.arrayBuffer()); } catch { return invalid("Unable to read transcription file"); }
  if (!bytes.length || bytes.length > ELEVENLABS_MAX_STT_FILE_BYTES) return invalid("Invalid transcription file size");
  const body = new FormData();
  body.append("model_id", model);
  if (language) body.append("language_code", language);
  const name = (file.name || "audio.wav").replace(/\.opus$/i, ".ogg").replace(/["\r\n]/g, "_");
  body.append("file", new Blob([bytes], { type: file.type || "application/octet-stream" }), name);
  return { body, format };
}
/** Submit once to the fixed origin. Uncertain dispatched work carries acceptedJob; it must not be replayed. */
export function createElevenLabsSttAdapter({ fetchImpl, timeoutMs = ELEVENLABS_STT_TIMEOUT_MS, maxTranscriptBytes = ELEVENLABS_MAX_TRANSCRIPT_BYTES } = {}) {
  return { provider: ELEVENLABS_PROVIDER_ID, models: ELEVENLABS_STT_MODELS, responseFormats: ELEVENLABS_RESPONSE_FORMATS,
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildElevenLabsTranscriptionRequest(model, formData, { kind });
      if (!built.body) return built;
      const token = elevenLabsToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable ElevenLabs API key on this connection");
      const sent = await sendOnce(ELEVENLABS_TRANSCRIPTION_URL, { method: "POST", headers: { "xi-api-key": token }, body: built.body }, { credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;
      try {
        const type = (sent.response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!/(^application\/json$|\+json$)/.test(type)) { discard(sent.response); return lostResult("answered without a JSON transcript"); }
        let data;
        try { data = JSON.parse((await readBounded(sent.response.body, maxTranscriptBytes, sent.fetchSignal, HTTP_STATUS.BAD_GATEWAY)).toString("utf8")); }
        catch { return signal?.aborted ? withAcceptedJob(createErrorResult(499, "ElevenLabs transcription aborted after dispatch"), "accepted") : lostResult("returned an unreadable transcript", sent.timedOut() ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY); }
        if (!data || typeof data !== "object" || Array.isArray(data) || errorEnvelopeMessage(data) || typeof data.text !== "string") return lostResult("returned an unusable transcript");
        const words = Array.isArray(data.words) ? data.words.filter((w) => w && typeof w.text === "string" && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end >= w.start && w.type === "word").map(({ text, start, end }) => ({ word: text, start, end })) : [];
        const result = built.format === "verbose_json" ? { text: data.text, ...(typeof data.language_code === "string" ? { language: data.language_code } : {}), ...(words.length ? { words } : {}) } : { text: data.text };
        const accounting = mediaAccounting(null, ELEVENLABS_PROVIDER_ID, "stt");
        accounting.meta = { model, responseFormat: built.format };
        return { success: true, response: new Response(built.format === "text" ? data.text : JSON.stringify(result), { headers: { "Content-Type": built.format === "text" ? "text/plain" : "application/json", "Access-Control-Allow-Origin": "*" } }), ...(data.usage && typeof data.usage === "object" && !Array.isArray(data.usage) ? { usageValue: { usage: data.usage } } : {}), nativeUnits: {}, accounting };
      } finally { sent.clear(); }
    } };
}
export const elevenLabsSttAdapter = createElevenLabsSttAdapter();
