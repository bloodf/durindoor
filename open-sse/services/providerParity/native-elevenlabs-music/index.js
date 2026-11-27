/**
 * Staged (unregistered) native ElevenLabs Eleven Music adapter.
 *
 * Ported from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
 * - open-sse/config/musicRegistry.ts                      (`elevenlabs`, format `elevenlabs-music`)
 * - open-sse/handlers/musicGeneration.ts                  (`elevenlabs-music` dispatch)
 * - open-sse/handlers/mediaGeneration/elevenLabsMusic.ts  (handleElevenLabsMusicGeneration)
 * - open-sse/handlers/mediaGeneration/elevenLabsSchemas.ts (elevenLabsMusicSchema)
 *
 * Wire contract (synchronous, binary reply, no job id, no polling):
 *   POST https://api.elevenlabs.io/v1/music?output_format=<format, default mp3_44100_128>
 *        Content-Type: application/json
 *        xi-api-key: <credentials.apiKey || credentials.accessToken>
 *   body { model_id, music_length_ms?, force_instrumental?, prompt? | composition_plan?,
 *          seed?, finetune_id?, respect_sections_durations?, store_for_inpainting?, sign_with_c2pa? }
 *   reply raw audio bytes (Content-Type audio/* or application/octet-stream)
 *
 * Distinct from local ElevenLabs TTS (`/v1/text-to-speech/{voice}`). Nothing here
 * is imported by production code; registration.json lists the integration points.
 */

import { createErrorResult } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  ELEVENLABS_MUSIC_BASE_URL,
  ELEVENLABS_MUSIC_CONFIG,
  ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT,
  ELEVENLABS_MUSIC_FORMAT,
  ELEVENLABS_MUSIC_LIMITS,
  ELEVENLABS_MUSIC_MIME_TO_FORMAT,
  ELEVENLABS_MUSIC_ORIGIN,
  ELEVENLABS_MUSIC_OUTPUT_FORMAT,
  ELEVENLABS_MUSIC_PROVIDER_ALIASES,
  ELEVENLABS_MUSIC_PROVIDER_ID,
} from "./config.js";
import { buildElevenLabsMusicAuth, clampMs, discardBody, elevenLabsStatusLabel, raceStop, readBoundedBytes, retryAfterMs } from "./transport.js";

export {
  ELEVENLABS_MUSIC_BASE_URL,
  ELEVENLABS_MUSIC_CONFIG,
  ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT,
  ELEVENLABS_MUSIC_FORMAT,
  ELEVENLABS_MUSIC_LIMITS,
  ELEVENLABS_MUSIC_MIME_TO_FORMAT,
  ELEVENLABS_MUSIC_ORIGIN,
  ELEVENLABS_MUSIC_PROVIDER_ALIASES,
  ELEVENLABS_MUSIC_PROVIDER_ID,
  buildElevenLabsMusicAuth,
};

const DEFAULT_TOTAL_TIMEOUT_MS = 300_000;
const MAX_TOTAL_TIMEOUT_MS = 900_000;
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_COMPOSITION_PLAN_BYTES = 256 * 1024;
const REFUSAL_STATUSES = new Set([400, 401, 402, 403, 404, 409, 422, 429]);
// Source NATIVE_FIELDS: copied verbatim when defined.
const NATIVE_FIELDS = ["prompt", "composition_plan", "seed", "finetune_id", "respect_sections_durations", "store_for_inpainting", "sign_with_c2pa"];
const ALLOWED_FIELDS = new Set([
  ...NATIVE_FIELDS, "model", "music_length_ms", "duration", "force_instrumental", "instrumental",
  "output_format", "stream", "response_format", "user",
]);
const FORMAT_TO_MIME = Object.freeze({
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac",
  pcm: "audio/pcm", ulaw: "audio/basic", alaw: "audio/x-alaw-basic",
});

/** Accepts the source registry key and the local registry alias. */
export function isElevenLabsMusicProvider(provider) {
  return provider === ELEVENLABS_MUSIC_PROVIDER_ID || ELEVENLABS_MUSIC_PROVIDER_ALIASES.includes(provider);
}

/** Only the pinned registry models; ElevenLabs publishes no music model listing in the source. */
export function isElevenLabsMusicModel(model) {
  return isString(model) && ELEVENLABS_MUSIC_CONFIG.models.some((m) => m.id === model);
}

/** Static catalog from the pinned registry entry (the source has no music discovery). */
export function listElevenLabsMusicModels() {
  return ELEVENLABS_MUSIC_CONFIG.models.map((m) => ({ ...m, provider: ELEVENLABS_MUSIC_PROVIDER_ID, serviceKinds: ["music"] }));
}

const isInt = (value) => Number.isInteger(value);
const optionalBoolean = (body, key) => body[key] === undefined || isBoolean(body[key]);

/**
 * Validate the caller body against the source schema before anything is sent.
 * Returns `{ error }` or `{ model, outputFormat, payload }` with the exact source wire body.
 */
export function buildElevenLabsMusicRequest(model, body) {
  if (!isRecord(body)) return { error: "Request body must be a JSON object" };
  const resolvedModel = isString(model) ? model.trim() : "";
  if (!isElevenLabsMusicModel(resolvedModel)) return { error: `Unsupported ElevenLabs music model: ${resolvedModel || "(empty)"}` };
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) return { error: `Unsupported field for ElevenLabs music: ${key}` };
  }
  if (body.stream !== undefined && body.stream !== false) return { error: "ElevenLabs music streaming is not supported on this route" };
  if (body.response_format !== undefined && body.response_format !== "b64_json") return { error: "ElevenLabs music only returns b64_json" };
  if (body.user !== undefined && !isString(body.user)) return { error: "user must be a string" };
  const outputFormat = body.output_format ?? ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT;
  if (!isString(outputFormat)) return { error: "output_format must be a string" };
  if (!ELEVENLABS_MUSIC_OUTPUT_FORMAT.test(outputFormat)) return { error: `Unsupported output_format: ${outputFormat.slice(0, 40)}` };
  if (body.duration !== undefined && body.duration !== null && !isNumber(body.duration)) return { error: "duration must be a number of seconds" };

  // Source buildNativeMusicBody: native milliseconds win over seconds; force_instrumental wins over instrumental.
  const payload = {
    model_id: resolvedModel,
    music_length_ms: body.music_length_ms ?? (isNumber(body.duration) ? body.duration * 1000 : undefined),
    force_instrumental: body.force_instrumental ?? body.instrumental,
  };
  for (const field of NATIVE_FIELDS) if (body[field] !== undefined) payload[field] = body[field];

  // Source elevenLabsMusicSchema.
  const { prompt, composition_plan: plan, music_length_ms: lengthMs, seed } = payload;
  if (prompt !== undefined && prompt !== null) {
    if (!isString(prompt) || !prompt.trim()) return { error: "prompt must be a non-empty string" };
    if (prompt.length > ELEVENLABS_MUSIC_LIMITS.promptMaxChars) return { error: `prompt must be at most ${ELEVENLABS_MUSIC_LIMITS.promptMaxChars} characters` };
  }
  if (plan !== undefined && plan !== null) {
    if (!isRecord(plan) || Array.isArray(plan)) return { error: "composition_plan must be an object" };
    if (Buffer.byteLength(JSON.stringify(plan)) > MAX_COMPOSITION_PLAN_BYTES) return { error: "composition_plan is too large" };
  }
  if (Boolean(prompt) === Boolean(plan)) return { error: "Provide exactly one of prompt or composition_plan" };
  if (lengthMs !== undefined && lengthMs !== null) {
    if (!isInt(lengthMs) || lengthMs < ELEVENLABS_MUSIC_LIMITS.musicLengthMinMs || lengthMs > ELEVENLABS_MUSIC_LIMITS.musicLengthMaxMs) {
      return { error: `music_length_ms must be an integer between ${ELEVENLABS_MUSIC_LIMITS.musicLengthMinMs} and ${ELEVENLABS_MUSIC_LIMITS.musicLengthMaxMs}` };
    }
  }
  if (seed !== undefined && seed !== null && (!isInt(seed) || seed < 0 || seed > ELEVENLABS_MUSIC_LIMITS.seedMax)) {
    return { error: `seed must be an integer between 0 and ${ELEVENLABS_MUSIC_LIMITS.seedMax}` };
  }
  for (const key of ["force_instrumental", "respect_sections_durations", "store_for_inpainting", "sign_with_c2pa"]) {
    if (!optionalBoolean(payload, key)) return { error: `${key} must be a boolean` };
  }
  if (payload.finetune_id !== undefined && payload.finetune_id !== null && (!isString(payload.finetune_id) || !payload.finetune_id.trim())) {
    return { error: "finetune_id must be a non-empty string" };
  }
  // JSON.stringify drops undefined, exactly as the source request does.
  return { model: resolvedModel, outputFormat, payload: JSON.parse(JSON.stringify(payload)) };
}

/** Exact request URL on the fixed ElevenLabs origin. */
export function buildElevenLabsMusicUrl(outputFormat = ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT) {
  const url = new URL(ELEVENLABS_MUSIC_BASE_URL);
  url.searchParams.set("output_format", outputFormat);
  if (url.protocol !== "https:" || url.origin !== ELEVENLABS_MUSIC_ORIGIN || url.pathname !== "/v1/music" || url.hash) {
    throw new Error("ElevenLabs music endpoint origin rejected");
  }
  return url.toString();
}

/** Source format resolution: known content type first, then the requested codec. */
export function elevenLabsMusicFormat(contentType, outputFormat) {
  const base = isString(contentType) ? contentType.split(";")[0].trim().toLowerCase() : "";
  if (Object.hasOwn(ELEVENLABS_MUSIC_MIME_TO_FORMAT, base)) return ELEVENLABS_MUSIC_MIME_TO_FORMAT[base];
  return outputFormat.split("_")[0];
}

/** True when the bytes match the claimed container; raw codecs only need bytes. */
export function audioMatchesFormat(buffer, format) {
  if (!buffer || buffer.length === 0) return false;
  if (["pcm", "ulaw", "alaw"].includes(format)) return true;
  if (buffer.length < 4) return false;
  const ascii = (start, end) => buffer.toString("ascii", start, end);
  switch (format) {
    case "mp3":
      return ascii(0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && ((buffer[1] >> 1) & 0x03) !== 0);
    case "wav": return buffer.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
    case "ogg":
    case "opus": return ascii(0, 4) === "OggS";
    case "flac": return ascii(0, 4) === "fLaC";
    default: return false;
  }
}

/** Parse a RIFF/WAVE buffer; returns duration seconds or null when malformed. */
export function wavDurationSeconds(buffer) {
  if (!buffer || buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let byteRate = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || start + 16 > buffer.length) return null;
      byteRate = buffer.readUInt32LE(start + 8);
    } else if (id === "data") {
      if (!byteRate || size === 0 || start + size > buffer.length) return null;
      return size / byteRate;
    }
    offset = start + size + (size % 2);
  }
  return null;
}

// Gateway outcome for a submit ElevenLabs may have run and billed: cost unknown.
function acceptedJob(jobState, meta = {}) {
  const accounting = mediaAccounting(null, ELEVENLABS_MUSIC_PROVIDER_ID, "music");
  return { ...accounting, costSource: "accepted-job", meta: { ...accounting.meta, jobState, ...meta } };
}

function fail(status, message, credentials, extra = {}) {
  return { ...createErrorResult(status, message, undefined, undefined, null, credentials), ...extra };
}

/**
 * Generate one Eleven Music track for the selected ElevenLabs connection.
 *
 * Result shapes follow musicGenerationCore: success `{ success, outcome, connectionId, accounting, response }`;
 * failure is createErrorResult(...) plus `outcome`, `connectionId` and, when ElevenLabs
 * may have taken the request, `acceptedJob` (unknown cost). One submit; never retried.
 */
export async function handleElevenLabsMusicGeneration({
  model, body, credentials, signal = null, log = null,
  fetchImpl = proxyAwareFetch,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const connectionId = credentials?.connectionId ?? null;
  const request = buildElevenLabsMusicRequest(model, body);
  if (request.error) return fail(400, request.error, credentials, { outcome: "rejected", connectionId });
  const auth = buildElevenLabsMusicAuth(credentials);
  if (!auth) return fail(401, "ElevenLabs API key is required", credentials, { outcome: "rejected", connectionId });
  let url;
  try {
    url = buildElevenLabsMusicUrl(request.outputFormat);
  } catch {
    return fail(400, "ElevenLabs music endpoint origin rejected", credentials, { outcome: "rejected", connectionId });
  }
  if (signal?.aborted) return fail(499, "Request aborted; nothing was submitted", credentials, { outcome: "aborted", connectionId });

  const deadline = AbortSignal.timeout(clampMs(totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS, MAX_TOTAL_TIMEOUT_MS));
  const overall = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const stopStatus = (error) => (error?.kind === "abort" ? 499 : 504);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  log?.info?.("MUSIC", `${ELEVENLABS_MUSIC_PROVIDER_ID}/${request.model} (${ELEVENLABS_MUSIC_FORMAT}, ${request.outputFormat})`);
  const requested = { outputFormat: request.outputFormat };
  if (request.payload.music_length_ms) requested.requestedMusicLengthMs = request.payload.music_length_ms;

  // Submit exactly once. A lost answer is possibly accepted work and is never replayed.
  let response;
  try {
    response = await raceStop(fetchImpl(url, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify(request.payload),
      signal: overall,
      redirect: "manual",
    }, proxyOptions), overall, signal);
  } catch (error) {
    const status = error?.kind ? stopStatus(error) : 502;
    const reason = error?.kind ? error.message : "network failure";
    return fail(status, `ElevenLabs music submit outcome unknown (${reason}); it was not resubmitted`, credentials, {
      outcome: "outcome_unknown", acceptedJob: acceptedJob("submit_outcome_unknown", requested), connectionId,
    });
  }

  const status = response.status;
  if (status >= 300 && status < 400) {
    discardBody(response);
    return fail(502, `ElevenLabs music submit was redirected (HTTP ${status}); the redirect was not followed`, credentials, { outcome: "refused", connectionId });
  }

  if (status < 200 || status >= 300) {
    let label = "";
    try {
      const read = await readBoundedBytes(response, MAX_ERROR_BYTES, overall, signal);
      label = read.buffer ? elevenLabsStatusLabel(read.buffer) : "";
    } catch { /* body is never surfaced */ }
    // ElevenLabs publishes no "5xx is not billed" contract: any 5xx may have run the generation.
    if (status >= 500) {
      return fail(502, `ElevenLabs music submit outcome unknown (HTTP ${status}${label}); it was not resubmitted`, credentials, {
        outcome: "outcome_unknown", acceptedJob: acceptedJob("submit_outcome_unknown", { ...requested, httpStatus: status }), connectionId,
      });
    }
    const clientStatus = REFUSAL_STATUSES.has(status) ? status : 502;
    const resetsAtMs = status === 429 ? retryAfterMs(response, now) : undefined;
    return { ...createErrorResult(clientStatus, `ElevenLabs music refused the request (HTTP ${status}${label})`, resetsAtMs, undefined, null, credentials), outcome: "refused", connectionId };
  }

  // 2xx: ElevenLabs ran the generation. Anything unusable stays an accepted job.
  const malformed = (reason) => fail(502, `ElevenLabs music returned malformed audio (${reason})`, credentials, {
    outcome: "accepted_malformed", acceptedJob: acceptedJob("accepted_malformed", { ...requested, httpStatus: status }), connectionId,
  });
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
    discardBody(response);
    return malformed("non-audio response");
  }
  let audio;
  try {
    const read = await readBoundedBytes(response, MAX_AUDIO_BYTES, overall, signal);
    if (read.tooLarge) return malformed("audio exceeds the size limit");
    audio = read.buffer;
  } catch (error) {
    const stopped = Boolean(error?.kind);
    return fail(stopped ? stopStatus(error) : 502, stopped ? `${error.message} while reading the ElevenLabs music result` : "ElevenLabs music returned an unreadable result", credentials, {
      outcome: "accepted_unreadable", acceptedJob: acceptedJob("accepted_unreadable", { ...requested, httpStatus: status }), connectionId,
    });
  }
  if (audio.length === 0) return malformed("empty audio");
  const format = elevenLabsMusicFormat(contentType, request.outputFormat);
  if (!audioMatchesFormat(audio, format)) return malformed(`not a ${format} container`);

  const item = { b64_json: audio.toString("base64"), format, mime_type: FORMAT_TO_MIME[format] };
  const accounting = mediaAccounting(null, ELEVENLABS_MUSIC_PROVIDER_ID, "music");
  accounting.state = "complete";
  Object.assign(accounting.meta, { clips: 1, audioBytes: audio.length, ...requested });
  if (format === "wav") {
    const seconds = wavDurationSeconds(audio);
    if (!(seconds > 0) || !Number.isFinite(seconds)) return malformed("not a wav container");
    item.duration_seconds = seconds;
    accounting.nativeUnits.audioSeconds = seconds;
    accounting.meta.nativeUnitsSource = "response WAV data chunk";
  }
  const normalized = {
    object: "music.generation",
    created: Math.floor(now() / 1000),
    provider: ELEVENLABS_MUSIC_PROVIDER_ID,
    model: request.model,
    status: "completed",
    data: [item],
  };
  return {
    success: true,
    outcome: "completed",
    connectionId,
    accounting,
    response: new Response(JSON.stringify(normalized), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
  };
}

const elevenLabsMusicAdapter = {
  id: ELEVENLABS_MUSIC_PROVIDER_ID,
  aliases: ELEVENLABS_MUSIC_PROVIDER_ALIASES,
  config: ELEVENLABS_MUSIC_CONFIG,
  listModels: listElevenLabsMusicModels,
  isProvider: isElevenLabsMusicProvider,
  generate: handleElevenLabsMusicGeneration,
};

export default elevenLabsMusicAdapter;
