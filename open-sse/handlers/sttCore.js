import { Buffer } from "node:buffer";
import { createErrorResult, sanitizeErrorMessageWithSecrets } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { resolveLocalWhisperHost } from "../config/providers.js";
import { assertOutboundUrlAllowed, guardedProbeFetch, PROVIDER_URL_BLOCKED_MESSAGE } from "../utils/outboundUrlGuard.js";
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";

// OpenAI-compatible transcription path appended to a user-supplied origin. The
// resolver deliberately returns only the origin, so the route stays fixed and a
// stored path cannot redirect audio somewhere else.
const STT_TRANSCRIPTION_PATH = "/v1/audio/transcriptions";
const STT_TRANSLATION_PATH = "/v1/audio/translations";
const TRANSCRIPTION_SUFFIX_RE = /\/audio\/transcriptions\/?$/;

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

// Deepgram: raw binary POST + model query param
async function transcribeDeepgram(cfg, file, model, token, formData) {
  const url = new URL(cfg.baseUrl);
  url.searchParams.set("model", model);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  const lang = formData.get("language");
  if (isString(lang) && lang.trim()) url.searchParams.set("language", lang.trim());else
  url.searchParams.set("detect_language", "true");

  const buf = await file.arrayBuffer();
  const res = await fetch(url, {
    method: "POST",
    headers: { ...buildAuthHeaders(cfg, token), "Content-Type": resolveAudioContentType(file) },
    body: buf
  });
  if (!res.ok) return upstreamError(res, [token]);
  const data = await res.json();
  const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return jsonResponse({ text }, data, data.metadata?.duration);
}

/** Sends AssemblyAI language_code when supplied, otherwise enabling detection (upstream #3058). */
async function transcribeAssemblyAI(cfg, file, model, token, formData) {
  const auth = buildAuthHeaders(cfg, token);
  const buf = await file.arrayBuffer();
  const up = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST", headers: { ...auth, "Content-Type": "application/octet-stream" }, body: buf
  });
  if (!up.ok) return upstreamError(up, [token]);
  const { upload_url } = await up.json();
  const payload = { audio_url: upload_url, speech_models: [model] };
  const lang = formData.get("language");
  if (isString(lang) && lang.trim()) payload.language_code = lang.trim();else
  payload.language_detection = true;

  const sub = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!sub.ok) return upstreamError(sub, [token]);
  const { id } = await sub.json();

  const start = Date.now();
  while (Date.now() - start < 120_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${cfg.baseUrl}/${id}`, { headers: auth });
    if (!poll.ok) continue;
    const r = await poll.json();
    if (r.status === "completed") return jsonResponse({ text: r.text || "" }, r, r.audio_duration);
    // Terminal errors can echo the token used for this transcription.
    if (r.status === "error") return createErrorResult(500, sanitizeErrorMessageWithSecrets(r.error || "AssemblyAI failed", [token]));
  }
  return createErrorResult(504, "AssemblyAI timeout after 120s");
}

// Hosted NVIDIA NIM: the configured function selects the model, not a form field.
async function transcribeNvidia(cfg, file, model, token, formData, proxyOptions) {
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
  const res = await proxyAwareFetch(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  if (formData.get("response_format") === "text") {
    return { success: true, response: new Response(await res.text(), { headers: { "Content-Type": "text/plain" } }) };
  }
  const data = await res.json();
  if (!isString(data?.text)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "NVIDIA ASR returned no transcript");
  return jsonResponse(data);
}

// Gemini 3.5 Transcribe uses Files + Interactions; other Gemini models retain generateContent fallback.
async function transcribeGemini(cfg, file, model, token, formData, proxyOptions) {
  if (model !== "gemini-3.5-transcribe") return transcribeGeminiGenerateContent(cfg, file, model, token, formData, proxyOptions);
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
  const start = await proxyAwareFetch("https://generativelanguage.googleapis.com/upload/v1beta/files", { method: "POST", headers: { "x-goog-api-key": token, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(content.byteLength), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" }, body: JSON.stringify({ file: { display_name: file.name || "audio" } }) }, proxyOptions);
  if (!start.ok) return upstreamError(start, [token]);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Gemini upload did not provide a resumable URL");
  const upload = await proxyAwareFetch(uploadUrl, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: content }, proxyOptions);
  if (!upload.ok) return upstreamError(upload, [token]);
  const uploaded = await upload.json();
  if (!uploaded?.file?.uri) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Gemini upload did not provide a file URI");
  const transcription = { language_codes: language ? [String(language)] : [], ...(vocabulary.length ? { custom_vocabulary: vocabulary } : null), mode: mode === "smart" ? "smart" : { type: "verbatim", ...(diarization ? { diarization_mode: diarization } : null), ...(timestamps.length ? { timestamp_granularities: timestamps } : null) } };
  const interaction = await proxyAwareFetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "x-goog-api-key": token, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: [{ type: "audio", uri: uploaded?.file?.uri, mime_type: uploaded?.file?.mime_type || mime }], generation_config: { transcription_config: transcription } }) }, proxyOptions);
  if (!interaction.ok) return upstreamError(interaction, [token]);
  const data = await interaction.json();
  return jsonResponse({ text: data?.output_text || data?.outputs?.flatMap((output) => output.content || []).map((contentPart) => contentPart.text).filter(Boolean).join("") || "" }, data);
}

async function transcribeGeminiGenerateContent(cfg, file, model, token, formData, proxyOptions) {
  const buf = await file.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  const mime = resolveAudioContentType(file);
  const lang = formData.get("language");
  const userPrompt = formData.get("prompt");
  let promptText = userPrompt && isString(userPrompt) && userPrompt.trim() ? userPrompt.trim() : "Generate a transcript of the speech. Return only the transcribed text, no commentary.";
  if (isString(lang) && lang.trim()) promptText += ` Language: ${lang.trim()}.`;
  const res = await proxyAwareFetch(`${cfg.baseUrl}/${model}:generateContent?key=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: mime, data: b64 } }] }] }) }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  const data = await res.json();
  return jsonResponse({ text: data?.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("") || "" }, data);
}

// HuggingFace: POST raw binary to {baseUrl}/{model_id}
async function transcribeHuggingFace(cfg, file, model, token) {
  if (model.includes("..") || model.includes("//")) return createErrorResult(400, "Invalid model ID");
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/${model}`;
  const buf = await file.arrayBuffer();
  const res = await fetch(url, {
    method: "POST",
    headers: { ...buildAuthHeaders(cfg, token), "Content-Type": resolveAudioContentType(file) },
    body: buf
  });
  if (!res.ok) return upstreamError(res, [token]);
  const data = await res.json();
  return jsonResponse({ text: data.text || "" }, data);
}

// Default: OpenAI/Groq/Whisper-compatible multipart
async function transcribeOpenAICompatible(cfg, file, model, token, formData, proxyOptions) {
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.wav");
  fd.append("model", model);
  // Forward every client field as-is (covers timestamp_granularities[], include[], etc.); file/model set above
  for (const [k, v] of formData.entries()) {
    if (k === "file" || k === "model") continue;
    if (v !== null && v !== undefined && v !== "") fd.append(k, v);
  }
  // A user-supplied host is fetched through the outbound guard so DNS answers
  // are validated on the socket too: a hostname that passes the static check
  // can still resolve to a blocked address (DNS rebinding). Registry-fixed
  // endpoints retain proxy-aware connection routing.
  const res = cfg.userConfigurableHost ?
    await guardedProbeFetch(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd }) :
    await proxyAwareFetch(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  return await transcriptionResponse(res);
}

// MiniMax and xAI require options before multipart file; MiniMax language is an HTTP header.
async function transcribeNativeSpeech(cfg, file, model, token, formData, proxyOptions) {
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
  const res = await proxyAwareFetch(cfg.baseUrl, { method: "POST", headers, body: fd }, proxyOptions);
  if (!res.ok) return upstreamError(res, [token]);
  return await transcriptionResponse(res);
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
  if (duration !== undefined && (!isNumber(duration) || !Number.isFinite(duration) || duration < 0)) {
    throw new TypeError("STT provider duration must be nonnegative seconds");
  }
  return {
    usageValue: data?.usageMetadata ? { usageMetadata: usage } : { usage },
    nativeUnits: duration === undefined ? {} : { audioSeconds: duration },
  };
}

async function transcriptionResponse(res) {
  const contentType = res.headers.get("content-type") || "application/json";
  // Text/subtitle responses expose no duration; preserve their stream unchanged.
  if (!/(?:application\/json|\+json)/i.test(contentType)) {
    return { success: true, response: new Response(res.body, { status: res.status, headers: { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" } }) };
  }
  const text = await res.text();
  return {
    success: true,
    ...transcriptionUsage(JSON.parse(text)),
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
export async function handleSttCore({ provider, model, formData, credentials, sttConfig, kind = "transcription" }) {
  const file = formData.get("file");
  if (!file) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");

  let cfg = sttConfig;
  if (!cfg) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support STT`);

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

  const token = cfg.authType === "none" ? null : credentials?.apiKey || credentials?.accessToken;
  if (cfg.authType !== "none" && !token) {
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `No credentials for STT provider: ${provider}`);
  }

  if (cfg.format === "cohere-stt" && (!isString(formData.get("language")) || !formData.get("language").trim())) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Cohere transcription requires language");
  }
  try {
    const proxyOptions = resolveCredentialProxyOptions(credentials);
    switch (cfg.format) {
      case "deepgram":return await transcribeDeepgram(cfg, file, model, token, formData);
      case "assemblyai":return await transcribeAssemblyAI(cfg, file, model, token, formData);
      case "nvidia-asr":return await transcribeNvidia(cfg, file, model, token, formData, proxyOptions);
      case "huggingface-asr":return await transcribeHuggingFace(cfg, file, model, token);
      case "gemini-stt":return await transcribeGemini(cfg, file, model, token, formData, proxyOptions);
      case "minimax-stt":
      case "xai-stt":return await transcribeNativeSpeech(cfg, file, model, token, formData, proxyOptions);
      case "cohere-stt":return await transcribeNativeSpeech(cfg, file, model, token, formData, proxyOptions);
      default:return await transcribeOpenAICompatible(cfg, file, model, token, formData, proxyOptions);
    }
  } catch (err) {
    const secrets = [credentials?.apiKey, credentials?.accessToken, credentials?.refreshToken];
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeErrorMessageWithSecrets(err?.message || "STT request failed", secrets));
  }
}