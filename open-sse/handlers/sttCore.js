import { Buffer } from "node:buffer";
import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { resolveLocalWhisperHost } from "../config/providers.js";
import { assertOutboundUrlAllowed, guardedProbeFetch, PROVIDER_URL_BLOCKED_MESSAGE } from "../utils/outboundUrlGuard.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

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

async function upstreamError(res) {
  let txt = "";
  try {txt = await res.text();} catch {}
  let msg = txt || `Upstream error (${res.status})`;
  try {const j = JSON.parse(txt);msg = j?.error?.message || j?.error || j?.message || msg;} catch {}
  return createErrorResult(res.status, isString(msg) ? msg : JSON.stringify(msg));
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
  if (!res.ok) return upstreamError(res);
  const data = await res.json();
  const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return jsonResponse({ text });
}

/** Sends AssemblyAI language_code when supplied, otherwise enabling detection (upstream #3058). */
async function transcribeAssemblyAI(cfg, file, model, token, formData) {
  const auth = buildAuthHeaders(cfg, token);
  const buf = await file.arrayBuffer();
  const up = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST", headers: { ...auth, "Content-Type": "application/octet-stream" }, body: buf
  });
  if (!up.ok) return upstreamError(up);
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
  if (!sub.ok) return upstreamError(sub);
  const { id } = await sub.json();

  const start = Date.now();
  while (Date.now() - start < 120_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${cfg.baseUrl}/${id}`, { headers: auth });
    if (!poll.ok) continue;
    const r = await poll.json();
    if (r.status === "completed") return jsonResponse({ text: r.text || "" });
    if (r.status === "error") return createErrorResult(500, r.error || "AssemblyAI failed");
  }
  return createErrorResult(504, "AssemblyAI timeout after 120s");
}

// Nvidia NIM: multipart, normalize response
async function transcribeNvidia(cfg, file, model, token) {
  const fd = new FormData();
  fd.append("file", file, file.name || "audio.wav");
  fd.append("model", model);
  const res = await fetch(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd });
  if (!res.ok) return upstreamError(res);
  const data = await res.json();
  return jsonResponse({ text: data.text || data.transcript || "" });
}

// Gemini: generateContent with inline_data audio + transcription prompt
async function transcribeGemini(cfg, file, model, token, formData) {
  const buf = await file.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  const mime = resolveAudioContentType(file);
  const lang = formData.get("language");
  const userPrompt = formData.get("prompt");
  let promptText = userPrompt && isString(userPrompt) && userPrompt.trim() ?
  userPrompt.trim() :
  "Generate a transcript of the speech. Return only the transcribed text, no commentary.";
  if (isString(lang) && lang.trim()) promptText += ` Language: ${lang.trim()}.`;

  const url = `${cfg.baseUrl}/${model}:generateContent?key=${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: mime, data: b64 } }] }]
    })
  });
  if (!res.ok) return upstreamError(res);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") || "";
  return jsonResponse({ text });
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
  if (!res.ok) return upstreamError(res);
  const data = await res.json();
  return jsonResponse({ text: data.text || "" });
}

// Default: OpenAI/Groq/Whisper-compatible multipart
async function transcribeOpenAICompatible(cfg, file, model, token, formData) {
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
  // endpoints keep the plain fetch path.
  const send = cfg.userConfigurableHost ?
  (url, init) => guardedProbeFetch(url, init) :
  fetch;
  const res = await send(cfg.baseUrl, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd });
  if (!res.ok) return upstreamError(res);
  const ct = res.headers.get("content-type") || "application/json";
  const txt = await res.text();
  return { success: true, response: new Response(txt, { status: 200, headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*" } }) };
}

function jsonResponse(obj) {
  return {
    success: true,
    response: new Response(JSON.stringify(obj), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })
  };
}

/** OpenAI-format STT configs have a sibling `/audio/translations` endpoint. */
export function supportsSttTranslation(cfg) {
  return cfg?.format === "openai" && TRANSCRIPTION_SUFFIX_RE.test(cfg.baseUrl || "");
}

/**
 * STT core handler — dispatch by sttConfig.format.
 * `kind: "translation"` targets the OpenAI-style `/audio/translations` route;
 * only OpenAI-format providers have one, so other formats are rejected.
 * @returns {Promise<{success, response, status?, error?}>}
 */
export async function handleSttCore({ provider, model, formData, credentials, sttConfig, kind = "transcription" }) {
  const file = formData.get("file");
  if (!file) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");

  let cfg = sttConfig;
  if (!cfg) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support STT`);

  const translate = kind === "translation";
  if (translate && !supportsSttTranslation(cfg)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support audio translations`);
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

  try {
    switch (cfg.format) {
      case "deepgram":return await transcribeDeepgram(cfg, file, model, token, formData);
      case "assemblyai":return await transcribeAssemblyAI(cfg, file, model, token, formData);
      case "nvidia-asr":return await transcribeNvidia(cfg, file, model, token);
      case "huggingface-asr":return await transcribeHuggingFace(cfg, file, model, token);
      case "gemini-stt":return await transcribeGemini(cfg, file, model, token, formData);
      default:return await transcribeOpenAICompatible(cfg, file, model, token, formData);
    }
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err.message || "STT request failed");
  }
}