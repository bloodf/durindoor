/**
 * Staged (unregistered) native Gemini API Lyria 3 music adapter.
 *
 * Ported from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
 * - open-sse/config/musicRegistry.ts                 (`gemini`, format `gemini-lyria`)
 * - open-sse/handlers/musicGeneration.ts             (`gemini-lyria` dispatch)
 * - open-sse/handlers/mediaGeneration/geminiMusic.ts (handleGeminiMusicGeneration)
 * - open-sse/executors/vertexMedia.ts                (extractInlineAudio)
 *
 * Wire contract (synchronous, no job id, no polling, no generationConfig):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *        Content-Type: application/json
 *        x-goog-api-key: <key>          (API-key connection; wins when both are present)
 *        Authorization: Bearer <token>  (OAuth connection)
 *   body  { contents: [{ role: "user", parts: [{ text: <trimmed prompt> }] }] }
 *   reply { candidates: [{ content: { parts: [{ text }, { inlineData: { mimeType, data } }] } }], usageMetadata }
 *
 * This is distinct from local Vertex Lyria 2 (`:predict`, native-vertex-music)
 * and from Gemini TTS/STT. Nothing here is imported by production code;
 * registration.json lists the integration points for the serial registration.
 */

import { createErrorResult } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GEMINI_MUSIC_BASE_URL,
  GEMINI_MUSIC_CONFIG,
  GEMINI_MUSIC_FORMAT,
  GEMINI_MUSIC_FORMAT_TO_MIME,
  GEMINI_MUSIC_MIME_TO_FORMAT,
  GEMINI_MUSIC_MODEL_ID,
  GEMINI_MUSIC_ORIGIN,
  GEMINI_MUSIC_PROVIDER_ALIASES,
  GEMINI_MUSIC_PROVIDER_ID,
} from "./config.js";
import { discoverGeminiMusicModels, geminiMusicDiscoveryUrl, listGeminiMusicModels, parseGeminiMusicModels } from "./discovery.js";
import { buildGeminiMusicAuth, clampMs, discardBody, googleStatusLabel, raceStop, readBounded, retryAfterMs } from "./transport.js";

export {
  GEMINI_MUSIC_BASE_URL,
  GEMINI_MUSIC_CONFIG,
  GEMINI_MUSIC_FORMAT,
  GEMINI_MUSIC_MIME_TO_FORMAT,
  GEMINI_MUSIC_ORIGIN,
  GEMINI_MUSIC_PROVIDER_ALIASES,
  GEMINI_MUSIC_PROVIDER_ID,
  buildGeminiMusicAuth,
  discoverGeminiMusicModels,
  geminiMusicDiscoveryUrl,
  listGeminiMusicModels,
  parseGeminiMusicModels,
};

const DEFAULT_TOTAL_TIMEOUT_MS = 300_000;
const MAX_TOTAL_TIMEOUT_MS = 600_000;
const MAX_PROMPT_CHARS = 32_000;
const MAX_SUCCESS_BYTES = 64 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ENUM = /^[A-Z_]{1,40}$/;
const NORMAL_FINISH = new Set(["STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED"]);
const ALLOWED_FIELDS = new Set(["model", "prompt", "response_format", "stream", "user"]);

/** Accepts only the source registry key; the source declares no alias. */
export function isGeminiMusicProvider(provider) {
  return provider === GEMINI_MUSIC_PROVIDER_ID || GEMINI_MUSIC_PROVIDER_ALIASES.includes(provider);
}

/** Static ids plus any ids discovered for this connection, all pattern-checked. */
export function isGeminiMusicModel(model, discovered = []) {
  if (!isString(model) || !GEMINI_MUSIC_MODEL_ID.test(model)) return false;
  if (GEMINI_MUSIC_CONFIG.models.some((m) => m.id === model)) return true;
  return Array.isArray(discovered) && discovered.some((m) => (isString(m) ? m : m?.id) === model);
}

/**
 * Validate the caller body against the source subset before anything is sent.
 * Returns `{ error }` or `{ model, payload }` with the exact source wire body.
 */
export function buildGeminiMusicRequest(model, body, discovered = []) {
  if (!isRecord(body)) return { error: "Request body must be a JSON object" };
  const resolvedModel = isString(model) ? model.trim() : "";
  if (!isGeminiMusicModel(resolvedModel, discovered)) return { error: `Unsupported Gemini music model: ${resolvedModel || "(empty)"}` };
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) return { error: `Unsupported field for Gemini Lyria: ${key}` };
  }
  if (!isString(body.prompt) || !body.prompt.trim()) return { error: "Missing required field: prompt" };
  const prompt = body.prompt.trim();
  if (prompt.length > MAX_PROMPT_CHARS) return { error: `prompt must be at most ${MAX_PROMPT_CHARS} characters` };
  if (body.response_format !== undefined && body.response_format !== "b64_json") return { error: "Gemini Lyria only returns b64_json" };
  if (body.stream !== undefined && body.stream !== false) return { error: "Gemini Lyria does not support streaming" };
  if (body.user !== undefined && !isString(body.user)) return { error: "user must be a string" };
  return { model: resolvedModel, payload: { contents: [{ role: "user", parts: [{ text: prompt }] }] } };
}

/** Exact request URL on the fixed Gemini API origin. */
export function buildGeminiMusicUrl(model) {
  const url = new URL(`${GEMINI_MUSIC_BASE_URL}/${encodeURIComponent(model)}:generateContent`);
  if (url.protocol !== "https:" || url.origin !== GEMINI_MUSIC_ORIGIN || url.search || url.hash) throw new Error("Gemini Lyria endpoint origin rejected");
  return url.toString();
}

/** Container from the inline part's mime type (source resolveFormat) or null when unknown. */
export function geminiMusicFormat(mimeType) {
  if (!isString(mimeType)) return null;
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return Object.hasOwn(GEMINI_MUSIC_MIME_TO_FORMAT, base) ? GEMINI_MUSIC_MIME_TO_FORMAT[base] : null;
}

/** True when the decoded bytes start with the signature of the claimed container. */
export function audioMatchesFormat(buffer, format) {
  if (!buffer || buffer.length < 4) return false;
  const ascii = (start, end) => buffer.toString("ascii", start, end);
  switch (format) {
    case "mp3":
      // ID3v2 tag, or an MPEG audio frame sync with a non-reserved layer.
      return ascii(0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && ((buffer[1] >> 1) & 0x03) !== 0);
    case "wav": return buffer.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
    case "ogg": return ascii(0, 4) === "OggS";
    case "flac": return ascii(0, 4) === "fLaC";
    case "aac": return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
    case "m4a": return buffer.length >= 8 && ascii(4, 8) === "ftyp";
    case "webm": return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
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

/** Source extractInlineAudio: the first inline part with non-empty data in candidates[0]. */
export function extractGeminiInlineAudio(parsed) {
  const parts = parsed?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const inline = part?.inlineData;
    if (isRecord(inline) && isString(inline.data) && inline.data.length > 0) return { data: inline.data, mimeType: inline.mimeType };
  }
  return null;
}

function blockLabel(parsed) {
  const block = parsed?.promptFeedback?.blockReason;
  if (isString(block) && ENUM.test(block)) return block;
  const finish = parsed?.candidates?.[0]?.finishReason;
  if (isString(finish) && ENUM.test(finish) && !NORMAL_FINISH.has(finish)) return finish;
  return null;
}

// Gateway outcome for a submit Google may have run and billed: tokens if reported, cost unknown.
function acceptedJob(jobState, meta = {}, parsed = null) {
  const accounting = mediaAccounting(parsed, GEMINI_MUSIC_PROVIDER_ID, "music");
  return { ...accounting, costSource: "accepted-job", meta: { ...accounting.meta, jobState, ...meta } };
}

function fail(status, message, credentials, extra = {}) {
  return { ...createErrorResult(status, message, undefined, undefined, null, credentials), ...extra };
}

/**
 * Generate one Lyria 3 track for the selected Gemini connection.
 *
 * Result shapes follow musicGenerationCore: success `{ success, outcome, connectionId, accounting, response }`;
 * failure is createErrorResult(...) plus `outcome`, `connectionId` and, when Google
 * may have taken the request, `acceptedJob` (unknown cost). One submit; never retried.
 * `models` may carry ids from discoverGeminiMusicModels for this connection.
 */
export async function handleGeminiMusicGeneration({
  model, body, credentials, signal = null, log = null, models = [],
  fetchImpl = proxyAwareFetch,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const connectionId = credentials?.connectionId ?? null;
  const request = buildGeminiMusicRequest(model, body, models);
  if (request.error) return fail(400, request.error, credentials, { outcome: "rejected", connectionId });
  const auth = buildGeminiMusicAuth(credentials);
  if (!auth) return fail(401, "Gemini API key or OAuth access token is required", credentials, { outcome: "rejected", connectionId });
  let url;
  try {
    url = buildGeminiMusicUrl(request.model);
  } catch {
    return fail(400, "Gemini Lyria endpoint origin rejected", credentials, { outcome: "rejected", connectionId });
  }
  if (signal?.aborted) return fail(499, "Request aborted; nothing was submitted", credentials, { outcome: "aborted", connectionId });

  const deadline = AbortSignal.timeout(clampMs(totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS, MAX_TOTAL_TIMEOUT_MS));
  const overall = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const stopStatus = (error) => (error?.kind === "abort" ? 499 : 504);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  log?.info?.("MUSIC", `${GEMINI_MUSIC_PROVIDER_ID}/${request.model} (${GEMINI_MUSIC_FORMAT}, ${auth.mode})`);

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
    return fail(status, `Gemini Lyria submit outcome unknown (${reason}); it was not resubmitted`, credentials, {
      outcome: "outcome_unknown", acceptedJob: acceptedJob("submit_outcome_unknown"), connectionId,
    });
  }

  const status = response.status;
  if (status >= 300 && status < 400) {
    discardBody(response);
    return fail(502, `Gemini Lyria submit was redirected (HTTP ${status}); the redirect was not followed`, credentials, { outcome: "refused", connectionId });
  }

  if (status < 200 || status >= 300) {
    let label = "";
    try {
      const read = await readBounded(response, MAX_ERROR_BYTES, overall, signal);
      label = read.text ? googleStatusLabel(read.text) : "";
    } catch { /* body is never surfaced */ }
    // 5xx other than 503 may have run the generation: keep it as possibly billed.
    // 503 is a refusal by status alone: Gemini API docs list 503 service_unavailable
    // ("temporarily overloaded or down", retry with backoff) and the billing FAQ says an
    // HTTP 4xx or 5xx error is not billed. See internal/docs/port-reports/native-audio-503-contract.md.
    if (status >= 500 && status !== 503) {
      return fail(502, `Gemini Lyria submit outcome unknown (HTTP ${status}${label}); it was not resubmitted`, credentials, {
        outcome: "outcome_unknown", acceptedJob: acceptedJob("submit_outcome_unknown", { httpStatus: status }), connectionId,
      });
    }
    const clientStatus = [400, 401, 403, 404, 429, 503].includes(status) ? status : 502;
    const resetsAtMs = status === 429 || status === 503 ? retryAfterMs(response, now) : undefined;
    return { ...createErrorResult(clientStatus, `Gemini Lyria refused the request (HTTP ${status}${label})`, resetsAtMs, undefined, null, credentials), outcome: "refused", connectionId };
  }

  // 2xx: Google ran the generation. Anything unusable stays an accepted job.
  let parsed;
  try {
    const read = await readBounded(response, MAX_SUCCESS_BYTES, overall, signal);
    if (read.tooLarge) throw new Error("too large");
    parsed = JSON.parse(read.text);
    if (!isRecord(parsed)) throw new Error("not an object");
  } catch (error) {
    const stopped = Boolean(error?.kind);
    return fail(stopped ? stopStatus(error) : 502, stopped ? `${error.message} while reading the Gemini Lyria result` : "Gemini Lyria returned an unreadable result", credentials, {
      outcome: "accepted_unreadable", acceptedJob: acceptedJob("accepted_unreadable", { httpStatus: status }), connectionId,
    });
  }

  const malformed = (reason) => fail(502, `Gemini Lyria returned malformed audio (${reason})`, credentials, {
    outcome: "accepted_malformed", acceptedJob: acceptedJob("accepted_malformed", { httpStatus: status }, parsed), connectionId,
  });
  const inline = extractGeminiInlineAudio(parsed);
  if (!inline) {
    const blocked = blockLabel(parsed);
    if (blocked) {
      return fail(400, `Gemini Lyria blocked the prompt (${blocked})`, credentials, {
        outcome: "accepted_blocked", acceptedJob: acceptedJob("accepted_blocked", { httpStatus: status, blockReason: blocked }, parsed), connectionId,
      });
    }
    return malformed("no audio content");
  }
  const format = geminiMusicFormat(inline.mimeType);
  if (!format) return malformed("unsupported mime type");
  if (!BASE64.test(inline.data)) return malformed("invalid base64");
  const bytes = Buffer.from(inline.data, "base64");
  if (!audioMatchesFormat(bytes, format)) return malformed(`not a ${format} container`);

  const item = { b64_json: inline.data, format, mime_type: GEMINI_MUSIC_FORMAT_TO_MIME[format] };
  const accounting = mediaAccounting(parsed, GEMINI_MUSIC_PROVIDER_ID, "music");
  accounting.state = "complete";
  accounting.meta.clips = 1;
  accounting.meta.audioBytes = bytes.length;
  if (format === "wav") {
    const seconds = wavDurationSeconds(bytes);
    if (!(seconds > 0) || !Number.isFinite(seconds)) return malformed("not a wav container");
    item.duration_seconds = seconds;
    accounting.nativeUnits.audioSeconds = seconds;
    accounting.meta.nativeUnitsSource = "inlineData WAV data chunk";
  }
  const normalized = {
    object: "music.generation",
    created: Math.floor(now() / 1000),
    provider: GEMINI_MUSIC_PROVIDER_ID,
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

const geminiMusicAdapter = {
  id: GEMINI_MUSIC_PROVIDER_ID,
  aliases: GEMINI_MUSIC_PROVIDER_ALIASES,
  config: GEMINI_MUSIC_CONFIG,
  listModels: listGeminiMusicModels,
  discoverModels: discoverGeminiMusicModels,
  isProvider: isGeminiMusicProvider,
  generate: handleGeminiMusicGeneration,
};

export default geminiMusicAdapter;
