/**
 * Staged (unregistered) native Vertex AI Lyria music adapter.
 *
 * Ported from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
 * - open-sse/config/musicRegistry.ts      (`vertex`, format `vertex-lyria`, model `lyria-002`)
 * - open-sse/handlers/musicGeneration.ts  (`vertex-lyria` branch)
 * - open-sse/executors/vertexMedia.ts     (`vertexGenerateMusic`, `buildModelRequest`)
 *
 * Wire contract (Lyria 2 is synchronous `:predict`, no job id, no polling):
 *   POST {origin}/v1/projects/{project}/locations/{location}/publishers/google/models/lyria-002:predict
 *        Authorization: Bearer <token>        (Service Account / ADC / preset OAuth token)
 *   POST https://aiplatform.googleapis.com/v1/publishers/google/models/lyria-002:predict?key=<key>
 *                                             (Vertex AI Express API key)
 *   body  { instances: [{ prompt, negative_prompt?, seed? }], parameters: { sample_count? } }
 *   reply { predictions: [{ bytesBase64Encoded: <WAV>, mimeType? }, ...] }
 *
 * Nothing here is imported by production code. registration.json lists the
 * integration points a later serial registration step must wire.
 */

import { createErrorResult } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { classifyVertexCredential, VERTEX_CREDENTIAL, refreshVertexToken, refreshGoogleToken } from "../../tokenRefresh.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";

export const VERTEX_MUSIC_PROVIDER_ID = "vertex";
export const VERTEX_MUSIC_PROVIDER_ALIASES = Object.freeze(["vx"]);
export const VERTEX_MUSIC_FORMAT = "vertex-lyria";
export const VERTEX_MUSIC_DEFAULT_MODEL = "lyria-002";
export const VERTEX_MUSIC_DEFAULT_LOCATION = "us-central1";
export const VERTEX_MUSIC_EXPRESS_ORIGIN = "https://aiplatform.googleapis.com";

/** Source registry entry (musicRegistry.ts) plus the gateway's explicit subset. */
export const VERTEX_MUSIC_CONFIG = Object.freeze({
  id: VERTEX_MUSIC_PROVIDER_ID,
  aliases: VERTEX_MUSIC_PROVIDER_ALIASES,
  baseUrl: "https://us-central1-aiplatform.googleapis.com/v1",
  authType: "apikey",
  authHeader: "bearer",
  format: VERTEX_MUSIC_FORMAT,
  serviceKind: "music",
  models: Object.freeze([Object.freeze({ id: VERTEX_MUSIC_DEFAULT_MODEL, name: "Lyria 2 (Vertex)" })]),
  output: Object.freeze({ container: "wav", mimeType: "audio/wav", responseFormat: "b64_json", stream: false }),
});

const MODEL_IDS = new Set(VERTEX_MUSIC_CONFIG.models.map((m) => m.id));
const MAX_SAMPLE_COUNT = 4;
const MAX_SEED = 0xffffffff;
const DEFAULT_TOTAL_TIMEOUT_MS = 180_000;
const DEFAULT_TOKEN_TIMEOUT_MS = 15_000;
const MAX_TOTAL_TIMEOUT_MS = 600_000;
const MAX_SUCCESS_BYTES = 64 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGIONAL_LOCATION = /^[a-z]+-[a-z]+[0-9]{1,2}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const GOOGLE_STATUS = /^[A-Z_]{1,40}$/;

const ALLOWED_FIELDS = new Set([
  "model", "prompt", "negative_prompt", "seed", "sample_count",
  "response_format", "output_format", "format",
  "instrumental", "is_instrumental", "make_instrumental", "user",
]);

/** Static catalog. The pinned source has no upstream discovery for Vertex music. */
export function listVertexMusicModels() {
  return VERTEX_MUSIC_CONFIG.models.map((m) => ({ ...m, provider: VERTEX_MUSIC_PROVIDER_ID, serviceKinds: ["music"] }));
}

/** Accepts the canonical id and the registry alias (`vx`). */
export function isVertexMusicProvider(provider) {
  return provider === VERTEX_MUSIC_PROVIDER_ID || VERTEX_MUSIC_PROVIDER_ALIASES.includes(provider);
}

// Gateway outcome for a 2xx (or possibly accepted) submit: Google may bill it; cost unknown.
function acceptedJob(jobState, meta = {}) {
  return { ...mediaAccounting(null, VERTEX_MUSIC_PROVIDER_ID, "music"), costSource: "accepted-job", meta: { jobState, ...meta } };
}

function fail(status, message, credentials, extra = {}) {
  return { ...createErrorResult(status, message, undefined, undefined, null, credentials), ...extra };
}

/**
 * Validate the caller body against the Lyria 2 `:predict` subset before anything
 * is minted or sent. Returns `{ error }` or `{ instance, parameters, model }`.
 */
export function buildVertexMusicRequest(model, body) {
  if (!isRecord(body)) return { error: "Request body must be a JSON object" };
  const resolvedModel = isString(model) && model.trim() ? model.trim() : VERTEX_MUSIC_DEFAULT_MODEL;
  if (!MODEL_IDS.has(resolvedModel)) return { error: `Unsupported Vertex music model: ${resolvedModel}` };
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) return { error: `Unsupported field for Vertex Lyria: ${key}` };
  }
  if (!isString(body.prompt) || !body.prompt.trim()) return { error: "Missing required field: prompt" };
  if (body.negative_prompt !== undefined && !isString(body.negative_prompt)) return { error: "negative_prompt must be a string" };
  if (body.seed !== undefined && (!Number.isInteger(body.seed) || body.seed < 0 || body.seed > MAX_SEED)) {
    return { error: `seed must be an integer between 0 and ${MAX_SEED}` };
  }
  if (body.sample_count !== undefined && (!Number.isInteger(body.sample_count) || body.sample_count < 1 || body.sample_count > MAX_SAMPLE_COUNT)) {
    return { error: `sample_count must be an integer between 1 and ${MAX_SAMPLE_COUNT}` };
  }
  // Lyria 2 rejects seed together with sample_count; fail before a billable call.
  if (body.seed !== undefined && body.sample_count !== undefined) return { error: "seed cannot be combined with sample_count" };
  if (body.response_format !== undefined && body.response_format !== "b64_json") {
    return { error: "Vertex Lyria only returns b64_json" };
  }
  for (const key of ["output_format", "format"]) {
    if (body[key] !== undefined && body[key] !== "wav") return { error: "Vertex Lyria only returns WAV audio" };
  }
  for (const key of ["instrumental", "is_instrumental", "make_instrumental"]) {
    if (body[key] !== undefined && body[key] !== true) return { error: "Vertex Lyria only generates instrumental music" };
  }
  if (body.user !== undefined && !isString(body.user)) return { error: "user must be a string" };

  const instance = { prompt: body.prompt };
  if (body.negative_prompt) instance.negative_prompt = body.negative_prompt;
  if (body.seed !== undefined) instance.seed = body.seed;
  const parameters = {};
  if (body.sample_count !== undefined) parameters.sample_count = body.sample_count;
  return { model: resolvedModel, instance, parameters };
}

/** Host for a location: global, US/EU multi-region representative hosts, or regional. */
export function vertexMusicOrigin(location) {
  if (location === "global") return VERTEX_MUSIC_EXPRESS_ORIGIN;
  if (location === "us" || location === "eu") return `https://aiplatform.${location}.rep.googleapis.com`;
  if (REGIONAL_LOCATION.test(location)) return `https://${location}-aiplatform.googleapis.com`;
  return null;
}

function resolveLocation(credentials) {
  const psd = credentials?.providerSpecificData;
  // `location` is the local connection field; `region` is the OmniRoute source field.
  const raw = isString(psd?.location) && psd.location.trim() ? psd.location : psd?.region;
  return isString(raw) && raw.trim() ? raw.trim() : VERTEX_MUSIC_DEFAULT_LOCATION;
}

/**
 * Classify the selected connection's credential without minting anything.
 * Mirrors executors/vertex.js: SA JSON and ADC mint Bearer tokens, a preset
 * accessToken is used as Bearer, a raw key uses the Express publisher endpoint.
 */
export function classifyVertexMusicAuth(credentials) {
  const credential = classifyVertexCredential(credentials?.apiKey);
  if (credential.error) return { error: credential.error };
  const saJson = credential.kind === VERTEX_CREDENTIAL.SERVICE_ACCOUNT ? credential.json : null;
  const adcJson = credential.kind === VERTEX_CREDENTIAL.ADC ? credential.json : null;
  const presetToken = isString(credentials?.accessToken) && credentials.accessToken.trim() ? credentials.accessToken.trim() : null;
  if (saJson || adcJson || presetToken) {
    const projectId = saJson?.project_id || adcJson?.quota_project_id || credentials?.providerSpecificData?.projectId;
    if (!isString(projectId) || !PROJECT_ID.test(projectId)) {
      return { error: "Vertex Lyria with Service Account/ADC/OAuth credentials requires a valid project_id" };
    }
    const location = resolveLocation(credentials);
    const origin = vertexMusicOrigin(location);
    if (!origin) return { error: "Vertex Lyria connection has an invalid location" };
    return { mode: saJson ? "service_account" : adcJson ? "adc" : "access_token", saJson, adcJson, presetToken, projectId, location, origin };
  }
  if (credential.kind === VERTEX_CREDENTIAL.API_KEY) {
    return { mode: "express", expressKey: credentials.apiKey.trim(), origin: VERTEX_MUSIC_EXPRESS_ORIGIN, location: null, projectId: null };
  }
  return { error: "Vertex Lyria requires a Service Account JSON, ADC JSON, OAuth access token, or Vertex AI Express API key" };
}

/** Exact request URL and headers for a classified auth and a bearer token. */
export function buildVertexMusicEndpoint(auth, model, bearerToken = null) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  let url;
  if (auth.mode === "express") {
    url = new URL(`${VERTEX_MUSIC_EXPRESS_ORIGIN}/v1/publishers/google/models/${encodeURIComponent(model)}:predict`);
    url.searchParams.set("key", auth.expressKey);
  } else {
    url = new URL(`${auth.origin}/v1/projects/${encodeURIComponent(auth.projectId)}/locations/${encodeURIComponent(auth.location)}/publishers/google/models/${encodeURIComponent(model)}:predict`);
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  // Fixed Google origins only; location already passed a strict pattern.
  if (url.protocol !== "https:" || url.origin !== auth.origin || !url.hostname.endsWith(".googleapis.com")) {
    throw new Error("Vertex Lyria endpoint origin rejected");
  }
  return { url: url.toString(), headers };
}

/** Parse a RIFF/WAVE buffer; returns duration seconds or null when malformed. */
export function wavDurationSeconds(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;
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

function stopError(kind, signal) {
  const error = new Error(kind === "abort" ? "Request aborted" : "Vertex Lyria deadline exceeded");
  error.kind = kind;
  if (kind === "abort" && signal?.reason) error.cause = signal.reason;
  return error;
}

function raceStop(promise, overall, callerSignal) {
  if (overall.aborted) return Promise.reject(stopError(callerSignal?.aborted ? "abort" : "deadline", callerSignal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(stopError(callerSignal?.aborted ? "abort" : "deadline", callerSignal));
    overall.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => overall.removeEventListener("abort", onAbort));
  });
}

async function readBounded(response, maxBytes, overall, callerSignal) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await raceStop(Promise.resolve(response.text()), overall, callerSignal);
    return Buffer.byteLength(text) > maxBytes ? { tooLarge: true } : { text };
  }
  const chunks = [];
  let total = 0;
  const onAbort = () => { void reader.cancel("vertex music read stopped").catch(() => {}); };
  overall.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await raceStop(reader.read(), overall, callerSignal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel("vertex music body too large").catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    overall.removeEventListener("abort", onAbort);
  }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") };
}

function googleStatusLabel(text) {
  try {
    const status = JSON.parse(text)?.error?.status;
    return isString(status) && GOOGLE_STATUS.test(status) ? ` ${status}` : "";
  } catch {
    return "";
  }
}

function retryAfterMs(response, now) {
  const raw = response.headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return now() + Math.min(seconds, 3600) * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? date : undefined;
}

const clampMs = (value, fallback, max) => (Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback);

/**
 * Generate music through Vertex AI Lyria 2 for the selected connection.
 *
 * Result shapes follow musicGenerationCore: success `{ success, accounting, response }`;
 * failure is createErrorResult(...) plus `outcome` and, when Google may have
 * taken the request, `acceptedJob` (unknown cost). One submit; never retried.
 */
export async function handleVertexMusicGeneration({
  model, body, credentials, signal = null, log = null,
  fetchImpl = proxyAwareFetch,
  mintServiceAccountToken = refreshVertexToken,
  refreshAdcToken = refreshGoogleToken,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
  tokenTimeoutMs = DEFAULT_TOKEN_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const connectionId = credentials?.connectionId ?? null;
  const request = buildVertexMusicRequest(model, body);
  if (request.error) return fail(400, request.error, credentials, { outcome: "rejected", connectionId });
  const auth = classifyVertexMusicAuth(credentials);
  if (auth.error) return fail(401, auth.error, credentials, { outcome: "rejected", connectionId });
  if (signal?.aborted) return fail(499, "Request aborted; nothing was submitted", credentials, { outcome: "aborted", connectionId });

  const deadline = AbortSignal.timeout(clampMs(totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS, MAX_TOTAL_TIMEOUT_MS));
  const overall = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const stopStatus = (error) => (error?.kind === "abort" ? 499 : 504);
  const proxyOptions = resolveCredentialProxyOptions(credentials);

  // 1. Mint the bearer token for the selected connection (nothing billable yet).
  let bearerToken = auth.presetToken || null;
  if (auth.mode === "service_account" || auth.mode === "adc") {
    const tokenSignal = AbortSignal.any([overall, AbortSignal.timeout(clampMs(tokenTimeoutMs, DEFAULT_TOKEN_TIMEOUT_MS, MAX_TOTAL_TIMEOUT_MS))]);
    try {
      const minted = await raceStop(
        auth.mode === "service_account" ?
          mintServiceAccountToken(auth.saJson, log, proxyOptions) :
          refreshAdcToken(auth.adcJson.refresh_token, auth.adcJson.client_id, auth.adcJson.client_secret, log, proxyOptions),
        tokenSignal, signal,
      );
      bearerToken = isString(minted?.accessToken) && minted.accessToken ? minted.accessToken : null;
    } catch (error) {
      if (error?.kind) return fail(stopStatus(error), `${error.message} while minting the Vertex token; nothing was submitted`, credentials, { outcome: error.kind === "abort" ? "aborted" : "timeout", connectionId });
      bearerToken = null;
    }
    if (!bearerToken) return fail(401, "Vertex Lyria could not obtain an access token for this connection", credentials, { outcome: "rejected", connectionId });
  }

  let endpoint;
  try {
    endpoint = buildVertexMusicEndpoint(auth, request.model, bearerToken);
  } catch {
    return fail(400, "Vertex Lyria endpoint origin rejected", credentials, { outcome: "rejected", connectionId });
  }
  if (overall.aborted) {
    const error = stopError(signal?.aborted ? "abort" : "deadline", signal);
    return fail(stopStatus(error), `${error.message}; nothing was submitted`, credentials, { outcome: error.kind === "abort" ? "aborted" : "timeout", connectionId });
  }

  // 2. Submit exactly once. A lost answer is possibly accepted work and is never replayed.
  let response;
  try {
    response = await raceStop(fetchImpl(endpoint.url, {
      method: "POST",
      headers: endpoint.headers,
      body: JSON.stringify({ instances: [request.instance], parameters: request.parameters }),
      signal: overall,
      redirect: "manual",
    }, proxyOptions), overall, signal);
  } catch (error) {
    const status = error?.kind ? stopStatus(error) : 502;
    const reason = error?.kind ? error.message : "network failure";
    return fail(status, `Vertex Lyria submit outcome unknown (${reason}); it was not resubmitted`, credentials, {
      outcome: "outcome_unknown", acceptedJob: acceptedJob("submit_outcome_unknown"), connectionId,
    });
  }

  const status = response.status;
  if (status >= 300 && status < 400) {
    void response.body?.cancel?.().catch(() => {});
    return fail(502, `Vertex Lyria submit was redirected (HTTP ${status}); the redirect was not followed`, credentials, { outcome: "refused", connectionId });
  }

  if (status < 200 || status >= 300) {
    let label = "";
    try {
      const read = await readBounded(response, MAX_ERROR_BYTES, overall, signal);
      label = read.text ? googleStatusLabel(read.text) : "";
    } catch { /* body is never surfaced */ }
    // 5xx other than 503 may have run the prediction: keep it as possibly billed.
    if (status >= 500 && status !== 503) {
      return fail(502, `Vertex Lyria submit outcome unknown (HTTP ${status}${label}); it was not resubmitted`, credentials, {
        outcome: "outcome_unknown", acceptedJob: acceptedJob("submit_outcome_unknown", { httpStatus: status }), connectionId,
      });
    }
    const clientStatus = [400, 401, 403, 404, 429, 503].includes(status) ? status : 502;
    const resetsAtMs = status === 429 || status === 503 ? retryAfterMs(response, now) : undefined;
    return { ...createErrorResult(clientStatus, `Vertex Lyria refused the request (HTTP ${status}${label})`, resetsAtMs, undefined, null, credentials), outcome: "refused", connectionId };
  }

  // 3. 2xx: Google accepted the prediction. Anything unreadable stays an accepted job.
  let parsed;
  try {
    const read = await readBounded(response, MAX_SUCCESS_BYTES, overall, signal);
    if (read.tooLarge) throw Object.assign(new Error("Vertex Lyria response exceeded the size limit"), { malformed: true });
    parsed = JSON.parse(read.text);
  } catch (error) {
    const stopped = Boolean(error?.kind);
    return fail(stopped ? stopStatus(error) : 502, stopped ? `${error.message} while reading the Vertex Lyria result` : "Vertex Lyria returned an unreadable result", credentials, {
      outcome: "accepted_unreadable", acceptedJob: acceptedJob("accepted_unreadable", { httpStatus: status }), connectionId,
    });
  }

  const predictions = Array.isArray(parsed?.predictions) ? parsed.predictions : null;
  const expected = request.parameters.sample_count ?? null;
  const malformed = (reason) => fail(502, `Vertex Lyria returned malformed audio (${reason})`, credentials, {
    outcome: "accepted_malformed", acceptedJob: acceptedJob("accepted_malformed", { httpStatus: status }), connectionId,
  });
  if (!predictions || predictions.length === 0) return malformed("no predictions");
  if (expected !== null && predictions.length > expected) return malformed("more clips than requested");

  const data = [];
  let audioSeconds = 0;
  for (const prediction of predictions) {
    const b64 = prediction?.bytesBase64Encoded;
    if (!isString(b64) || !b64 || !BASE64.test(b64)) return malformed("invalid base64");
    if (prediction.mimeType !== undefined && prediction.mimeType !== "audio/wav") return malformed("unexpected mime type");
    const seconds = wavDurationSeconds(Buffer.from(b64, "base64"));
    if (!(seconds > 0) || !Number.isFinite(seconds)) return malformed("not a WAV container");
    audioSeconds += seconds;
    data.push({ b64_json: b64, format: "wav", mime_type: "audio/wav", duration_seconds: seconds });
  }

  const accounting = mediaAccounting(null, VERTEX_MUSIC_PROVIDER_ID, "music");
  accounting.state = "complete";
  accounting.nativeUnits.audioSeconds = audioSeconds;
  accounting.meta.nativeUnitsSource = "predictions[].bytesBase64Encoded WAV data chunk";
  accounting.meta.clips = data.length;
  const normalized = {
    object: "music.generation",
    created: Math.floor(now() / 1000),
    provider: VERTEX_MUSIC_PROVIDER_ID,
    model: request.model,
    status: "completed",
    data,
  };
  return {
    success: true,
    outcome: "completed",
    connectionId,
    accounting,
    response: new Response(JSON.stringify(normalized), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
  };
}

const vertexMusicAdapter = {
  id: VERTEX_MUSIC_PROVIDER_ID,
  aliases: VERTEX_MUSIC_PROVIDER_ALIASES,
  config: VERTEX_MUSIC_CONFIG,
  listModels: listVertexMusicModels,
  isProvider: isVertexMusicProvider,
  generate: handleVertexMusicGeneration,
};

export default vertexMusicAdapter;
