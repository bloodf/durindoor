import { Buffer } from "node:buffer";
import { createErrorResult, errorEnvelopeMessage, sanitizeErrorMessageWithSecrets } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { transcribeCodex } from "./codexStt.js";
import { deepgramToVerboseJson, parseDeepgramOptions } from "./deepgramStt.js";
import { cloudflareEnvelopeError, cloudflareResultToDeepgram } from "./cloudflareStt.js";
import { resolveLocalWhisperHost } from "../config/providers.js";
import { assertOutboundUrlAllowed, guardedProbeFetch, PROVIDER_URL_BLOCKED_MESSAGE } from "../utils/outboundUrlGuard.js";
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { transcribeVertex } from "../services/providerParity/native-vertex-tts-stt/transcription.js";

// OpenAI-compatible transcription path appended to a user-supplied origin. The
// resolver deliberately returns only the origin, so the route stays fixed and a
// stored path cannot redirect audio somewhere else.
const STT_TRANSCRIPTION_PATH = "/v1/audio/transcriptions";
const STT_TRANSLATION_PATH = "/v1/audio/translations";
const TRANSCRIPTION_SUFFIX_RE = /\/audio\/transcriptions\/?$/;
const UNKNOWN_DURATION = Symbol("unknown duration");

/** Builds configured STT auth, including raw Authorization required by AssemblyAI (upstream #3058). */
function buildAuthHeaders(cfg, token) {
  if (!token) return {};
  switch (cfg.authHeader) {
    case "bearer":return { "Authorization": `Bearer ${token}` };
    case "token":return { "Authorization": `Token ${token}` };
    case "authorization":return { "Authorization": token };
    case "x-api-key":return { "x-api-key": token };
    case "key":return { "Authorization": `Key ${token}` };
    default:return { "Authorization": `Bearer ${token}` };
  }
}

// Map browser file MIME / ext → audio MIME for binary formats (deepgram/HF)
function resolveAudioContentType(file) {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("audio/")) return t;
  const name = isString(file.name) ? file.name.toLowerCase() : "";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const map = { mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", webm: "audio/webm", aac: "audio/aac", opus: "audio/opus" };
  return map[ext] || "application/octet-stream";
}

async function upstreamError(res, secrets = []) {
  let txt = "";
  try {txt = await res.text();} catch {}
  let msg = txt || `Upstream error (${res.status})`;
  try {const j = JSON.parse(txt);msg = j?.error?.message || j?.error || j?.message || msg;} catch {}
  const serialized = isString(msg) ? msg : JSON.stringify(msg);
  return createErrorResult(res.status, sanitizeErrorMessageWithSecrets(serialized, secrets));
}

function abortError(signal) {
  return signal?.reason instanceof Error ?
    signal.reason :
    new DOMException("STT request aborted", "AbortError");
}

function waitWithSignal(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(abortError(signal));
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (!settled) signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Failure result for an error envelope sent with HTTP 200 (9router #5864), or null. */
function envelopeFailure(data, token) {
  const message = errorEnvelopeMessage(data);
  return message ? createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeErrorMessageWithSecrets(message, [token])) : null;
}

// Deepgram: raw binary POST + model query param
async function transcribeDeepgram(cfg, file, model, token, formData, log, proxyOptions, signal) {
  const options = parseDeepgramOptions(formData);
  // A rejected option is the client's fault, so it must not cool the account down.
  if (options.error) return { ...createErrorResult(HTTP_STATUS.BAD_REQUEST, options.error), local: true };
  if (options.ignored.length) log?.warn?.("STT", `Deepgram ignored fields: ${JSON.stringify(options.ignored.slice(0, 20).map((name) => name.slice(0, 64)))}`);
  const url = new URL(cfg.baseUrl);
  url.searchParams.set("model", model);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  const lang = formData.get("language");
  if (isString(lang) && lang.trim()) url.searchParams.set("language", lang.trim());else
  url.searchParams.set("detect_language", "true");
  for (const [key, value] of Object.entries(options.query)) url.searchParams.set(key, value);

  const buf = await file.arrayBuffer();
  const res = await proxyAwareFetch(url, {
    method: "POST",
    headers: { ...buildAuthHeaders(cfg, token), "Content-Type": resolveAudioContentType(file) },
    body: buf,
    signal
  }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  // A successful upstream response may already be billed; malformed JSON is
  // treated like a missing transcript rather than retrying a paid request.
  const parsed = await res.json().catch((error) => {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  });
  const data = parsed !== null && isObject(parsed) && !Array.isArray(parsed) ? parsed : {};
  // An error envelope is not a billed transcription, unlike a missing transcript.
  const failed = envelopeFailure(data, token);
  if (failed) return failed;
  // Invalid usage cannot be recorded as known usage or trigger another paid call.
  const usage = data.usageMetadata ?? data.usage ?? data.meta?.tokens;
  const billingData = usage !== undefined && (usage === null || !isObject(usage) || Array.isArray(usage)) ? {} : data;
  // The audio is already billed, so a failure here would make a combo pay again
  // on the next model. A non-string transcript is treated like a missing one.
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (transcript !== undefined && transcript !== null && !isString(transcript)) {
    log?.warn?.("STT", "Deepgram returned a non-string transcript; using empty text");
  }
  const text = isString(transcript) ? transcript : "";
  // Keep a usable transcript when only the duration is malformed; the ledger then has no audio seconds.
  const rawDuration = data.metadata?.duration;
  const duration = isNumber(rawDuration) && Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : undefined;
  // Explicit sentinel prevents other provider duration fields from being inferred.
  if (options.responseFormat === "text") return textResponse(text, billingData, duration ?? UNKNOWN_DURATION);
  if (options.responseFormat === "verbose_json") {
    return jsonResponse(deepgramToVerboseJson(data, text, options, duration), billingData, duration ?? UNKNOWN_DURATION);
  }
  return jsonResponse({ text }, billingData, duration ?? UNKNOWN_DURATION);
}

// Cloudflare Workers AI (Deepgram Nova-3): raw binary POST to {baseUrl}/{model}
// with the account id in the path. Options and verbose_json follow the Deepgram path.
async function transcribeCloudflareWorkersAI(cfg, file, model, token, formData, credentials, log, proxyOptions, signal) {
  const options = parseDeepgramOptions(formData);
  if (options.error) return { ...createErrorResult(HTTP_STATUS.BAD_REQUEST, options.error), local: true };
  const rawAccountId = credentials?.providerSpecificData?.accountId;
  const accountId = isString(rawAccountId) ? rawAccountId.trim() : "";
  if (!accountId) {
    return { ...createErrorResult(HTTP_STATUS.BAD_REQUEST, "cloudflare-ai STT requires accountId in the connection's providerSpecificData"), local: true };
  }
  if (options.ignored.length) log?.warn?.("STT", `Cloudflare STT ignored fields: ${JSON.stringify(options.ignored.slice(0, 20).map((name) => name.slice(0, 64)))}`);
  const base = String(cfg.baseUrl).replace("{accountId}", encodeURIComponent(accountId)).replace(/\/+$/, "");
  const url = new URL(`${base}/${model}`);
  url.searchParams.set("punctuate", "true");
  const lang = formData.get("language");
  if (isString(lang) && lang.trim()) url.searchParams.set("language", lang.trim());
  // Segments are derived from words, so only the diarization switch is forwarded.
  for (const key of ["diarize", "diarize_model"]) if (options.query[key]) url.searchParams.set(key, options.query[key]);

  const res = await proxyAwareFetch(url, {
    method: "POST",
    headers: { ...buildAuthHeaders(cfg, token), "Content-Type": resolveAudioContentType(file) },
    body: await file.arrayBuffer(),
    signal
  }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  const parsed = await res.json().catch((error) => {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  });
  const data = isObject(parsed) && !Array.isArray(parsed) ? parsed : {};
  // Cloudflare reports failures as HTTP 200 with success:false.
  const envelopeError = cloudflareEnvelopeError(data);
  if (envelopeError) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeErrorMessageWithSecrets(envelopeError, [token]));
  const result = isObject(data.result) && !Array.isArray(data.result) ? data.result : {};
  const usage = result.usage;
  const billingData = usage !== undefined && (usage === null || !isObject(usage) || Array.isArray(usage)) ? {} : result;
  const deepgramBody = cloudflareResultToDeepgram(result);
  const transcript = deepgramBody.results.channels[0]?.alternatives?.[0]?.transcript;
  const text = isString(transcript) ? transcript : "";
  const rawDuration = result.metadata?.duration;
  const duration = isNumber(rawDuration) && Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : undefined;
  if (options.responseFormat === "text") return textResponse(text, billingData, duration ?? UNKNOWN_DURATION);
  if (options.responseFormat === "verbose_json") {
    const lastEnd = deepgramBody.results.utterances.at(-1)?.end;
    return jsonResponse(
      deepgramToVerboseJson(deepgramBody, text, options, duration ?? lastEnd),
      billingData,
      duration ?? UNKNOWN_DURATION
    );
  }
  return jsonResponse({ text }, billingData, duration ?? UNKNOWN_DURATION);
}

/**
 * Sends AssemblyAI language_code when supplied, otherwise enabling detection (upstream #3058).
 * Routes upload/submit/poll through proxyAwareFetch with the request abort signal.
 * Polling keeps retrying on 429 and 5xx, stops immediately on abort, and returns
 * the upstream error on non-retryable 4xx statuses.
 */
async function transcribeAssemblyAI(cfg, file, model, token, formData, proxyOptions, signal) {
  const auth = buildAuthHeaders(cfg, token);
  const buf = await file.arrayBuffer();
  const up = await proxyAwareFetch("https://api.assemblyai.com/v2/upload", {
    method: "POST", headers: { ...auth, "Content-Type": "application/octet-stream" }, body: buf, signal
  }, proxyOptions);
  if (!up.ok) return upstreamError(up, [token]);
  const uploaded = await up.json();
  const { upload_url } = uploaded;
  // Without this check a failed upload is submitted and polled for 120s.
  if (!isString(upload_url) || !upload_url) {
    return envelopeFailure(uploaded, token) || createErrorResult(HTTP_STATUS.BAD_GATEWAY, "AssemblyAI returned no upload URL");
  }
  const payload = { audio_url: upload_url, speech_models: [model] };
  const lang = formData.get("language");
  if (isString(lang) && lang.trim()) payload.language_code = lang.trim();else
  payload.language_detection = true;

  const sub = await proxyAwareFetch(cfg.baseUrl, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  }, proxyOptions);
  if (!sub.ok) return upstreamError(sub, [token]);
  const submitted = await sub.json();
  const { id } = submitted;
  if (!isString(id) || !id) {
    return envelopeFailure(submitted, token) || createErrorResult(HTTP_STATUS.BAD_GATEWAY, "AssemblyAI returned no transcript id");
  }

  const start = Date.now();
  while (Date.now() - start < 120_000) {
    await waitWithSignal(2000, signal);
    const poll = await proxyAwareFetch(`${cfg.baseUrl}/${id}`, { headers: auth, signal }, proxyOptions);
    if (!poll.ok) {
      if (poll.status === 429 || poll.status >= 500) {
        poll.body?.cancel?.().catch?.(() => {});
        continue;
      }
      return upstreamError(poll, [token]);
    }
    const r = await poll.json();
    if (r.status === "completed") return jsonResponse({ text: r.text || "" }, r, r.audio_duration);
    // Terminal errors can echo the token used for this transcription.
    if (r.status === "error") return createErrorResult(500, sanitizeErrorMessageWithSecrets(r.error || "AssemblyAI failed", [token]));
  }
  return createErrorResult(504, "AssemblyAI timeout after 120s");
}

// Hosted NVIDIA NIM: the configured function selects the model, not a form field.
async function transcribeNvidia(cfg, file, model, token, formData, proxyOptions, signal) {
  if (!cfg.models?.some((candidate) => candidate.id === model)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Unsupported NVIDIA transcription model: ${model}`);
  }
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.wav");
  fd.append("language", formData.get("language") || "en-US");
  for (const field of ["word_time_offsets", "response_format", "temperature"]) {
    const value = formData.get(field);
    if (value !== null) fd.append(field, value);
  }
  const res = await proxyAwareFetch(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd, signal }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  if (formData.get("response_format") === "text") {
    return { success: true, response: new Response(await res.text(), { headers: { "Content-Type": "text/plain" } }) };
  }
  const data = await res.json();
  if (!isString(data?.text)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "NVIDIA ASR returned no transcript");
  return jsonResponse(data);
}

// Gemini 3.5 Transcribe uses Files + Interactions; other Gemini models retain generateContent fallback.
async function transcribeGemini(cfg, file, model, token, formData, proxyOptions, signal) {
  if (model !== "gemini-3.5-transcribe") return transcribeGeminiGenerateContent(cfg, file, model, token, formData, proxyOptions, signal);
  const mime = resolveAudioContentType(file);
  const content = await file.arrayBuffer();
  const language = formData.get("language");
  const vocabulary = formData.getAll("custom_vocabulary").flatMap((value) => {
    if (!isString(value)) return [];
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [value]; } catch { return [value]; }
  }).map((value) => String(value).trim()).filter(Boolean);
  const mode = String(formData.get("mode") || "verbatim");
  const diarization = String(formData.get("diarization_mode") || "");
  const timestamps = formData.getAll("timestamp_granularities").map(String).filter(Boolean);
  if (vocabulary.length > 1000) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Gemini custom_vocabulary supports at most 1000 terms");
  if (vocabulary.length && (diarization || timestamps.length)) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Gemini custom_vocabulary cannot be combined with diarization or timestamps");
  if (!["smart", "verbatim"].includes(mode)) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Gemini transcription mode must be smart or verbatim");
  if (mode === "smart" && (diarization || timestamps.length)) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Gemini smart mode cannot be combined with diarization or timestamps");
  if (diarization && diarization !== "speaker") return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Gemini diarization_mode must be speaker");
  if (timestamps.some((value) => value !== "word")) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Gemini timestamp_granularities only supports word");
  const start = await proxyAwareFetch("https://generativelanguage.googleapis.com/upload/v1beta/files", { method: "POST", headers: { "x-goog-api-key": token, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(content.byteLength), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" }, body: JSON.stringify({ file: { display_name: file.name || "audio" } }), signal }, proxyOptions);
  if (!start.ok) return upstreamError(start, [token]);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Gemini upload did not provide a resumable URL");
  const upload = await proxyAwareFetch(uploadUrl, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: content, signal }, proxyOptions);
  if (!upload.ok) return upstreamError(upload, [token]);
  const uploaded = await upload.json();
  if (!uploaded?.file?.uri) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Gemini upload did not provide a file URI");
  const transcription = { language_codes: language ? [String(language)] : [], ...(vocabulary.length ? { custom_vocabulary: vocabulary } : null), mode: mode === "smart" ? "smart" : { type: "verbatim", ...(diarization ? { diarization_mode: diarization } : null), ...(timestamps.length ? { timestamp_granularities: timestamps } : null) } };
  const interaction = await proxyAwareFetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "x-goog-api-key": token, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: [{ type: "audio", uri: uploaded?.file?.uri, mime_type: uploaded?.file?.mime_type || mime }], generation_config: { transcription_config: transcription } }), signal }, proxyOptions);
  if (!interaction.ok) return upstreamError(interaction, [token]);
  const data = await interaction.json();
  return jsonResponse({ text: data?.output_text || data?.outputs?.flatMap((output) => output.content || []).map((contentPart) => contentPart.text).filter(Boolean).join("") || "" }, data);
}

async function transcribeGeminiGenerateContent(cfg, file, model, token, formData, proxyOptions, signal) {
  const buf = await file.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  const mime = resolveAudioContentType(file);
  const lang = formData.get("language");
  const userPrompt = formData.get("prompt");
  let promptText = userPrompt && isString(userPrompt) && userPrompt.trim() ? userPrompt.trim() : "Generate a transcript of the speech. Return only the transcribed text, no commentary.";
  if (isString(lang) && lang.trim()) promptText += ` Language: ${lang.trim()}.`;
  const res = await proxyAwareFetch(`${cfg.baseUrl}/${model}:generateContent?key=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: mime, data: b64 } }] }] }), signal }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  const data = await res.json();
  return envelopeFailure(data, token) ||
    jsonResponse({ text: data?.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("") || "" }, data);
}

// HuggingFace: POST raw binary to {baseUrl}/{model_id}
async function transcribeHuggingFace(cfg, file, model, token, proxyOptions, signal) {
  if (model.includes("..") || model.includes("//")) return createErrorResult(400, "Invalid model ID");
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(model)}`;
  const buf = await file.arrayBuffer();
  const res = await proxyAwareFetch(url, {
    method: "POST",
    headers: { ...buildAuthHeaders(cfg, token), "Content-Type": resolveAudioContentType(file) },
    body: buf,
    signal
  }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  const data = await res.json();
  return envelopeFailure(data, token) || jsonResponse({ text: data.text || "" }, data);
}

const TIMESTAMP_GRANULARITY_FIELDS = ["timestamp_granularities[]", "timestamp_granularities"];
const TIMESTAMP_GRANULARITIES = new Set(["word", "segment"]);

// OpenAI-compatible upstreams accept granularities only with verbose_json and only
// under the array field name, so both client spellings are merged there (9router#5840).
function appendTimestampGranularities(fd, formData) {
  if (String(formData.get("response_format") ?? "").trim().toLowerCase() !== "verbose_json") return;
  const values = TIMESTAMP_GRANULARITY_FIELDS.
  flatMap((name) => formData.getAll(name)).
  flatMap((value) => String(value).split(",")).
  map((value) => value.trim().toLowerCase()).
  filter((value) => TIMESTAMP_GRANULARITIES.has(value));
  for (const value of new Set(values)) fd.append("timestamp_granularities[]", value);
}

// Default: OpenAI/Groq/Whisper-compatible multipart
async function transcribeOpenAICompatible(cfg, file, model, token, formData, proxyOptions, signal) {
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.wav");
  fd.append("model", model);
  // Forward other client fields as-is (include[], etc.); file/model are set above
  for (const [k, v] of formData.entries()) {
    if (k === "file" || k === "model" || TIMESTAMP_GRANULARITY_FIELDS.includes(k)) continue;
    if (v !== null && v !== undefined && v !== "") fd.append(k, v);
  }
  appendTimestampGranularities(fd, formData);
  // A user-supplied host is fetched through the outbound guard so DNS answers
  // are validated on the socket too: a hostname that passes the static check
  // can still resolve to a blocked address (DNS rebinding). Registry-fixed
  // endpoints retain proxy-aware connection routing.
  const res = cfg.userConfigurableHost ?
    await guardedProbeFetch(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd, signal }) :
    await proxyAwareFetch(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd, signal }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  return await transcriptionResponse(res, token);
}

// MiniMax and xAI require options before multipart file; MiniMax language is an HTTP header.
async function transcribeNativeSpeech(cfg, file, model, token, formData, proxyOptions, signal) {
  const fd = new FormData();
  for (const [k, v] of formData.entries()) {
    if (k !== "file" && k !== "model" && v !== null && v !== undefined && v !== "") fd.append(k, v);
  }
  if (!(cfg.format === "xai-stt" && model === "stt")) fd.append("model", model);
  fd.append("file", file, file.name || "audio.wav");
  const headers = buildAuthHeaders(cfg, token);
  const language = formData.get("language");
  if (cfg.format === "minimax-stt" && isString(language) && language.trim()) {
    headers.language = language.trim();
    fd.delete("language");
  }
  const res = await proxyAwareFetch(cfg.baseUrl, { method: "POST", headers, body: fd, signal }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  return await transcriptionResponse(res, token);
}
/** Capture provider billing metadata before transcript normalization discards it.
 * Duration is seconds, never inferred from file bytes or transcript length.
 * Token values remain untouched for strict ledger validation, including totals.
 */
function transcriptionUsage(data, duration = data?.duration ?? (data?.usage?.type === "duration" ? data.usage.seconds : undefined)) {
  const usage = data?.usageMetadata ?? data?.usage ?? data?.meta?.tokens;
  if (usage !== undefined && (usage === null || !isObject(usage) || Array.isArray(usage))) {
    throw new TypeError("STT provider usage must be an object");
  }
  if (duration !== undefined && duration !== UNKNOWN_DURATION && (!isNumber(duration) || !Number.isFinite(duration) || duration < 0)) {
    throw new TypeError("STT provider duration must be nonnegative seconds");
  }
  return {
    usageValue: data?.usageMetadata ? { usageMetadata: usage } : { usage },
    nativeUnits: duration === undefined || duration === UNKNOWN_DURATION ? {} : { audioSeconds: duration },
  };
}

async function transcriptionResponse(res, token) {
  const contentType = res.headers.get("content-type") || "application/json";
  // Text/subtitle responses expose no duration; preserve their stream unchanged.
  if (!/(?:application\/json|\+json)/i.test(contentType)) {
    return { success: true, response: new Response(res.body, { status: res.status, headers: { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" } }) };
  }
  const text = await res.text();
  const data = JSON.parse(text);
  const failed = envelopeFailure(data, token);
  if (failed) return failed;
  return {
    success: true,
    ...transcriptionUsage(data),
    response: new Response(text, { status: res.status, headers: { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" } }),
  };
}

function jsonResponse(obj, data = obj, duration) {
  return {
    success: true,
    ...transcriptionUsage(data, duration),
    response: new Response(JSON.stringify(obj), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })
  };
}

function textResponse(text, data, duration) {
  return {
    success: true,
    ...transcriptionUsage(data, duration),
    response: new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    })
  };
}

/** OpenAI-format STT configs have a sibling `/audio/translations` endpoint. */
export function supportsSttTranslation(cfg, model = null) {
  return cfg?.format === "openai" && TRANSCRIPTION_SUFFIX_RE.test(cfg.baseUrl || "") && (!Array.isArray(cfg.translationModels) || cfg.translationModels.includes(model));
}

/**
 * STT core handler — dispatch by sttConfig.format.
 * `kind: "translation"` targets the OpenAI-style `/audio/translations` route;
 * only OpenAI-format providers have one, so other formats are rejected.
 * Successful results include usageValue and nativeUnits captured at provider decode.
 * @returns {Promise<{success, response, usageValue?, nativeUnits?, status?, error?}>}
 */
export async function handleSttCore({ provider, model, formData, credentials, sttConfig, kind = "transcription", signal, log }) {
  const file = formData.get("file");
  if (!file) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");

  let cfg = sttConfig;
  if (!cfg) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support STT`);

  // OAuth transcription uses a fixed ChatGPT endpoint; never honor connection URL overrides.
  if (provider === "codex" && cfg.format === "codex-transcribe") {
    if (kind === "translation") return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Codex transcription does not support audio translations");
    return transcribeCodex({ formData, credentials, signal });
  }

  const translate = kind === "translation";
  if (translate && !supportsSttTranslation(cfg, model)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Model '${model}' does not support audio translations for provider '${provider}'`);
  }

  // A self-hosted server's host belongs to the user, not the registry. Rebuild
  // the endpoint against the connection's stored origin so the base URL field
  // in the connection dialog actually takes effect; the registry value is the
  // default when nothing is stored.
  //
  // The stored value is operator input that reaches fetch() directly, so it goes
  // through the same outbound guard as every other user-supplied provider URL.
  // Under the default "block-metadata" policy loopback and LAN stay reachable —
  // a local Whisper box is the whole point — while cloud-metadata and
  // link-local targets are refused. transcribeOpenAICompatible additionally
  // sends through guardedProbeFetch so DNS answers are validated on the socket.
  if (cfg.userConfigurableHost) {
    const resolvedBaseUrl = `${resolveLocalWhisperHost(credentials)}${translate ? STT_TRANSLATION_PATH : STT_TRANSCRIPTION_PATH}`;
    try {
      assertOutboundUrlAllowed(resolvedBaseUrl);
    } catch (error) {
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, error.message || PROVIDER_URL_BLOCKED_MESSAGE);
    }
    cfg = { ...cfg, baseUrl: resolvedBaseUrl };
  } else if (translate) {
    cfg = { ...cfg, baseUrl: cfg.baseUrl.replace(TRANSCRIPTION_SUFFIX_RE, "/audio/translations") };
  }

  // Vertex Gemini transcription owns its auth modes (service account, ADC,
  // access token or Express key), endpoint and accepted-job receipts.
  if (cfg.format === "vertex-gemini") {
    return transcribeVertex({ model, formData, credentials, kind, signal, log });
  }

  const token = cfg.authType === "none" ? null : credentials?.apiKey || credentials?.accessToken;
  if (cfg.authType !== "none" && !token) {
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `No credentials for STT provider: ${provider}`);
  }

  if (cfg.format === "cohere-stt" && (!isString(formData.get("language")) || !formData.get("language").trim())) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Cohere transcription requires language");
  }
  if (signal?.aborted) {
    return { ...createErrorResult(499, "STT request aborted"), local: true };
  }

  try {
    const proxyOptions = resolveCredentialProxyOptions(credentials);
    switch (cfg.format) {
      case "deepgram":return await transcribeDeepgram(cfg, file, model, token, formData, log, proxyOptions, signal);
      case "cloudflare-workers-ai":return await transcribeCloudflareWorkersAI(cfg, file, model, token, formData, credentials, log, proxyOptions, signal);
      case "assemblyai":return await transcribeAssemblyAI(cfg, file, model, token, formData, proxyOptions, signal);
      case "nvidia-asr":return await transcribeNvidia(cfg, file, model, token, formData, proxyOptions, signal);
      case "huggingface-asr":return await transcribeHuggingFace(cfg, file, model, token, proxyOptions, signal);
      case "gemini-stt":return await transcribeGemini(cfg, file, model, token, formData, proxyOptions, signal);
      case "minimax-stt":
      case "xai-stt":return await transcribeNativeSpeech(cfg, file, model, token, formData, proxyOptions, signal);
      case "cohere-stt":return await transcribeNativeSpeech(cfg, file, model, token, formData, proxyOptions, signal);
      default:return await transcribeOpenAICompatible(cfg, file, model, token, formData, proxyOptions, signal);
    }
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") {
      return { ...createErrorResult(499, "STT request aborted"), local: true };
    }
    const secrets = [credentials?.apiKey, credentials?.accessToken, credentials?.refreshToken];
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeErrorMessageWithSecrets(err?.message || "STT request failed", secrets));
  }
}
