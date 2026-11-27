// SYNTX media adapters: image generation and edits (design/generate), video
// (video/generate), speech and music (audio/generate) and transcription
// (audio/transcribe). Source handlers: imageGeneration/providers/syntx.ts,
// videoGeneration/syntxHandler.ts and syntxAudio.ts (see ./config.js).
//
// Fork deviations, all refusals before anything is sent: a model that is not
// an exact catalog row of the requested kind (the source defaults or passes
// it through); an empty or oversized prompt; reference images that are
// neither a bounded base64 data URL nor a public https URL (the source drops
// them silently); references for a text-only model, more than the model
// takes, or none for a model that needs one; an audio_url that is not public
// https; response_format other than url/b64_json (speech: mp3 or none;
// transcription: json or text); translations. After the send see ./job.js.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import {
  SYNTX_JSON_MAX_BYTES, SYNTX_MAX_PROMPT_CHARS, SYNTX_MAX_REFERENCES, SYNTX_MEDIA_MAX_BYTES, SYNTX_PROVIDER_ID,
  SYNTX_TRANSCRIBE_MAX_BYTES, SYNTX_TRANSCRIBE_TIMEOUT_MS, SYNTX_TRANSCRIBE_URL, resolveSyntxModel, syntxModelsForKind,
} from "./config.js";
import { resolveSyntxCredential, syntxApiHeaders, syntxSecretSource } from "./auth.js";
import { downloadSyntxMedia, sniffAudioFormat, syntxPublicUrl } from "./download.js";
import {
  boundedFetch, defaultSyntxFetch, fail, offOrigin, parseJson, provenUnsent, readText, refusedAnswer, withAcceptedJob,
} from "./http.js";
import { runSyntxMediaJob, uploadSyntxReference } from "./job.js";
import { applySyntxProviderRules, mapSyntxAudioSettings, mapSyntxImageSettings, mapSyntxVideoSettings } from "./providerOptions.js";
import { isFunction, isNumber, isObject, isString } from "../../../../src/shared/utils/typeChecks.js";

export const SYNTX_MEDIA_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);
export const SYNTX_SPEECH_RESPONSE_FORMATS = Object.freeze(["mp3"]);
export const SYNTX_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text"]);
export const SYNTX_MISSING_JWT = "Missing SYNTX JWT — paste the Authorization Bearer token from syntx.ai";

const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i;
const CORS = { "Access-Control-Allow-Origin": "*" };
const reject = (message, status = HTTP_STATUS.BAD_REQUEST) => Object.assign(new Error(message), { status });
const jsonResponse = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
const nowSec = () => Math.floor(Date.now() / 1000);

/** Decoded size of a base64 string, checked before decoding (source decodeDataUrlBounded). */
export function decodeSyntxDataUrl(value, maxBytes = SYNTX_MEDIA_MAX_BYTES) {
  const text = isString(value) ? value.trim() : "";
  if (text.length > Math.ceil(maxBytes / 3) * 4 + 256) throw reject(`SYNTX reference exceeds ${maxBytes} bytes`);
  const match = DATA_URL_RE.exec(text);
  if (!match || match[2].length % 4 !== 0) return null;
  const pad = match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0;
  if ((match[2].length * 3) / 4 - pad > maxBytes) throw reject(`SYNTX reference exceeds ${maxBytes} bytes`);
  const bytes = Buffer.from(match[2], "base64");
  return bytes.byteLength > 0 ? { bytes, mime: match[1].toLowerCase() } : null;
}

function promptOf(value, what) {
  const prompt = isString(value) ? value.trim() : "";
  if (!prompt) throw reject(`Prompt is required for SYNTX ${what}`);
  if (prompt.length > SYNTX_MAX_PROMPT_CHARS) throw reject(`SYNTX ${what} prompt exceeds ${SYNTX_MAX_PROMPT_CHARS} characters`);
  return prompt;
}

function responseFormatOf(body) {
  const value = body?.response_format ?? "url";
  if (!SYNTX_MEDIA_RESPONSE_FORMATS.includes(value)) throw reject("SYNTX media supports response_format url or b64_json");
  return value;
}

function modelOf(model, kind) {
  const entry = resolveSyntxModel(model, kind);
  if (!entry) throw reject(`Unsupported SYNTX ${kind} model: use one of ${syntxModelsForKind(kind).map((row) => row.id).join(", ")}`);
  return entry;
}

function collectStrings(value, into) {
  if (isString(value) && value.trim()) into.push(value.trim());
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, into));
}

/**
 * Reference inputs as planned uploads or passthrough URLs, validated before
 * anything is sent. `files` are multipart Blobs (image edits).
 */
function planReferences(entry, refs, { mimePrefixes, files = [] }) {
  const unique = [...new Set(refs)];
  const total = unique.length + files.length;
  const max = entry.inputModalities.includes("image") ? Math.min(entry.caps.maxReferenceItems ?? SYNTX_MAX_REFERENCES, SYNTX_MAX_REFERENCES) : 0;
  if (total > max) {
    throw reject(max === 0 ? `SYNTX model ${entry.id} does not take reference images` : `SYNTX model ${entry.id} takes at most ${max} reference file(s)`);
  }
  if (entry.caps.imageRequired && total === 0) throw reject(`SYNTX model ${entry.id} requires a reference image`);
  const plan = [];
  for (const ref of unique) {
    if (ref.startsWith("data:")) {
      const decoded = decodeSyntxDataUrl(ref);
      if (!decoded || !mimePrefixes.some((prefix) => decoded.mime.startsWith(prefix))) throw reject("Could not decode a SYNTX reference data URL");
      plan.push({ upload: decoded });
    } else {
      const url = syntxPublicUrl(ref);
      if (!url) throw reject("SYNTX reference URLs must be public https URLs or base64 data URLs");
      plan.push({ url });
    }
  }
  return plan.concat(files.map((file) => ({ file })));
}

function extensionFor(mime, fallback) {
  if (mime.startsWith("video/")) return "mp4";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return fallback;
}

async function performUploads(plan, ctx, base) {
  const urls = [];
  for (const step of plan) {
    if (step.url) {
      urls.push(step.url);
      continue;
    }
    let bytes = step.upload?.bytes;
    let mime = step.upload?.mime;
    if (step.file) {
      if (step.file.size > SYNTX_MEDIA_MAX_BYTES) return { failure: fail(HTTP_STATUS.BAD_REQUEST, `SYNTX reference file exceeds ${SYNTX_MEDIA_MAX_BYTES} bytes`) };
      bytes = new Uint8Array(await step.file.arrayBuffer());
      mime = step.file.type || "image/png";
    }
    const uploaded = await uploadSyntxReference({ ...ctx, bytes, mimeType: mime, filename: `${base}.${extensionFor(mime, "png")}` });
    if (!uploaded.success) return { failure: uploaded };
    urls.push(uploaded.url);
  }
  return { urls };
}

function credentialContext(credentials, signal, options, log) {
  const token = resolveSyntxCredential(credentials);
  if (!token) return null;
  return { token, credentials, secrets: syntxSecretSource(credentials, token), signal, options: { ...options, log: options.log ?? log } };
}

/** Download every URL or none: any failure ends the request with acceptedJob, no partial output. */
async function downloadAll(urls, { signal, options, modality, secrets }) {
  const out = [];
  for (const url of urls) {
    const got = await downloadSyntxMedia(url, { signal, ...options.download });
    if (!got.success) {
      const message = got.reason === "aborted" ? `SYNTX ${modality} download was cancelled` : `SYNTX ${modality} result could not be downloaded (${got.reason})`;
      return { failure: withAcceptedJob(fail(got.status, message, secrets), modality, "accepted") };
    }
    out.push(got);
  }
  return { items: out };
}

const pickFirst = (media, type) => (media.find((item) => item.objectType === type) ?? media[0]).url;

// ── Image (generations and edits) ───────────────────────────────

/** Validate and map an image request. Throws status 400. */
export function buildSyntxImageRequest(model, body, { files = [], requireReference = false } = {}) {
  const prompt = promptOf(body?.prompt, "image generation");
  const responseFormat = responseFormatOf(body);
  const entry = modelOf(model, "image");
  const refs = [];
  for (const field of ["image_url", "image_urls", "image", "images"]) collectStrings(body?.[field], refs);
  const plan = planReferences(entry, refs, { mimePrefixes: ["image/"], files });
  if (requireReference && plan.length === 0) throw reject("Missing required field: image");
  return { entry, prompt, responseFormat, plan, settings: mapSyntxImageSettings(entry.aiName, entry.modelType, body ?? {}) };
}

async function runImage({ built, credentials, signal, log, options }) {
  const ctx = credentialContext(credentials, signal, options, log);
  if (!ctx) return fail(HTTP_STATUS.UNAUTHORIZED, SYNTX_MISSING_JWT);
  const uploads = await performUploads(built.plan, ctx, "reference");
  if (uploads.failure) return uploads.failure;
  const providerOptions = { model_type: built.entry.modelType, ...built.settings };
  if (uploads.urls.length > 0) providerOptions.image_url = uploads.urls;
  applySyntxProviderRules(built.entry.aiName, providerOptions, { modelType: built.entry.modelType, fileCount: uploads.urls.length });
  const job = await runSyntxMediaJob({
    ...ctx, scope: "image", route: "design", chatField: "chat_uuid", modality: "image", kindHint: "image",
    aiName: built.entry.aiName, prompt: built.prompt, settings: providerOptions, inputUrls: uploads.urls,
    options: { ...ctx.options, timeoutMs: built.timeoutMs ?? ctx.options.timeoutMs },
  });
  if (!job.success) return job;
  const urls = job.media.map((item) => item.url);
  let data = urls.map((url) => ({ url }));
  if (built.responseFormat === "b64_json") {
    const got = await downloadAll(urls, { signal, options: ctx.options, modality: "image", secrets: ctx.secrets });
    if (got.failure) return got.failure;
    data = got.items.map((item) => ({ b64_json: item.bytes.toString("base64") }));
  }
  const payload = { created: nowSec(), data };
  returnedImageUnits(job.accounting, payload);
  return { success: true, accounting: job.accounting, response: jsonResponse(payload) };
}

async function editInputs(formData, jsonBody) {
  if (jsonBody) return { body: jsonBody, files: [] };
  const body = {};
  for (const field of ["prompt", "size", "response_format", "quality", "aspect_ratio", "resolution"]) {
    const value = formData?.get?.(field);
    if (isString(value)) body[field] = value;
  }
  const n = formData?.get?.("n");
  if (isString(n) && n.trim()) body.n = Number(n);
  const files = [];
  for (const field of ["image", "image[]", "images", "images[]"]) {
    for (const value of formData?.getAll?.(field) ?? []) {
      if (isString(value)) (body.image_urls ??= []).push(value);
      else if (value && isFunction(value.arrayBuffer)) files.push(value);
    }
  }
  return { body, files };
}

export function createSyntxImageAdapter(options = {}) {
  return {
    async: true,
    provider: SYNTX_PROVIDER_ID,
    models: syntxModelsForKind("image"),
    responseFormats: SYNTX_MEDIA_RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** `{ success: true, response, accounting }` with `{ created, data }`, or an error result (acceptedJob once submitted). */
    async generate({ model, body, credentials, signal, log }) {
      let built;
      try {
        built = buildSyntxImageRequest(model, body);
      } catch (error) {
        return fail(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      built.timeoutMs = isNumber(body?.timeout_ms) ? body.timeout_ms : undefined;
      return runImage({ built, credentials, signal, log, options });
    },
    /** Native image-edit contract (imageEditCore): multipart formData or jsonBody; at least one image. */
    async edit({ model, formData, jsonBody, credentials, signal, log }) {
      let built;
      try {
        const { body, files } = await editInputs(formData, jsonBody);
        built = buildSyntxImageRequest(model, body, { files, requireReference: true });
      } catch (error) {
        return fail(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      return runImage({ built, credentials, signal, log, options });
    },
  };
}

// ── Video ───────────────────────────────────────────────────────

export function buildSyntxVideoRequest(model, body) {
  const prompt = promptOf(body?.prompt, "video generation");
  const responseFormat = responseFormatOf(body);
  const entry = modelOf(model, "video");
  const refs = [];
  for (const field of ["image", "image_url", "image_urls", "file_urls"]) collectStrings(body?.[field], refs);
  const plan = planReferences(entry, refs, { mimePrefixes: ["image/", "video/"] });
  let audioUrl;
  if (body?.audio_url !== undefined && body?.audio_url !== null) {
    audioUrl = syntxPublicUrl(body.audio_url);
    if (!audioUrl) throw reject("SYNTX audio_url must be a public https URL");
  }
  return { entry, prompt, responseFormat, plan, audioUrl, settings: mapSyntxVideoSettings(entry.aiName, entry.modelType, body ?? {}) };
}

export function createSyntxVideoAdapter(options = {}) {
  return {
    async: true,
    provider: SYNTX_PROVIDER_ID,
    models: syntxModelsForKind("video"),
    responseFormats: SYNTX_MEDIA_RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    async generate({ model, body, credentials, signal, log }) {
      let built;
      try {
        built = buildSyntxVideoRequest(model, body);
      } catch (error) {
        return fail(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const ctx = credentialContext(credentials, signal, options, log);
      if (!ctx) return fail(HTTP_STATUS.UNAUTHORIZED, SYNTX_MISSING_JWT);
      const uploads = await performUploads(built.plan, ctx, "frame");
      if (uploads.failure) return uploads.failure;
      const providerOptions = { model_type: built.entry.modelType, ...built.settings };
      applySyntxProviderRules(built.entry.aiName, providerOptions, { modelType: built.entry.modelType, fileCount: uploads.urls.length });
      const job = await runSyntxMediaJob({
        ...ctx, scope: "video", route: "video", chatField: "chat_id", modality: "video", kindHint: "video",
        aiName: built.entry.aiName, prompt: built.prompt, settings: providerOptions,
        fileUrls: uploads.urls.length ? uploads.urls : undefined, audioUrl: built.audioUrl,
        options: { ...ctx.options, timeoutMs: isNumber(body?.timeout_ms) ? body.timeout_ms : ctx.options.timeoutMs },
      });
      if (!job.success) return job;
      const url = pickFirst(job.media, "video");
      let item = { url, format: "mp4" };
      if (built.responseFormat === "b64_json") {
        const got = await downloadAll([url], { signal, options: ctx.options, modality: "video", secrets: ctx.secrets });
        if (got.failure) return got.failure;
        item = { b64_json: got.items[0].bytes.toString("base64"), format: "mp4" };
      }
      const accounting = { ...job.accounting, nativeUnits: { videos: 1 }, meta: { ...job.accounting.meta, nativeUnitsSource: "returned-videos" } };
      return { success: true, accounting, response: jsonResponse({ created: nowSec(), data: [item] }) };
    },
  };
}

// ── Speech (TTS) ────────────────────────────────────────────────

export function createSyntxTtsAdapter(options = {}) {
  return {
    async: true,
    provider: SYNTX_PROVIDER_ID,
    models: syntxModelsForKind("speech"),
    responseFormats: SYNTX_SPEECH_RESPONSE_FORMATS,
    /** TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` or an error result. */
    async synthesize(text, model, credentials, _responseFormat, callOptions = {}) {
      const { signal, log } = callOptions;
      const requested = callOptions.requestedResponseFormat ?? callOptions.response_format ?? null;
      let prompt;
      let entry;
      try {
        if (requested != null && !SYNTX_SPEECH_RESPONSE_FORMATS.includes(requested)) throw reject("SYNTX speech returns mp3 audio; omit response_format or use mp3");
        prompt = promptOf(text, "speech");
        entry = modelOf(model, "speech");
      } catch (error) {
        return fail(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const ctx = credentialContext(credentials, signal, options, log);
      if (!ctx) return fail(HTTP_STATUS.UNAUTHORIZED, SYNTX_MISSING_JWT);
      const providerOptions = { model_type: entry.modelType, ...mapSyntxAudioSettings(entry.aiName, entry.modelType, callOptions) };
      applySyntxProviderRules(entry.aiName, providerOptions, { modelType: entry.modelType, fileCount: 0 });
      const job = await runSyntxMediaJob({
        ...ctx, scope: "audio", route: "audio", chatField: "chat_uuid", modality: "tts", kindHint: "audio",
        aiName: entry.aiName, prompt, settings: providerOptions,
      });
      if (!job.success) return job;
      const got = await downloadAll([pickFirst(job.media, "audio")], { signal, options: ctx.options, modality: "tts", secrets: ctx.secrets });
      if (got.failure) return got.failure;
      const format = sniffAudioFormat(got.items[0].bytes);
      if (!format || (requested === "mp3" && format !== "mp3")) {
        return withAcceptedJob(fail(HTTP_STATUS.BAD_GATEWAY, "SYNTX speech returned audio in an unexpected container", ctx.secrets), "tts", "accepted");
      }
      return {
        base64: got.items[0].bytes.toString("base64"),
        format,
        accounting: { ...job.accounting, meta: { ...job.accounting.meta, nativeUnitsSource: "input-characters" } },
      };
    },
  };
}

// ── Music ───────────────────────────────────────────────────────

export function buildSyntxMusicRequest(model, body) {
  const prompt = promptOf(body?.prompt, "music generation");
  const responseFormat = responseFormatOf(body);
  const entry = modelOf(model, "music");
  const providerOptions = { model_type: entry.modelType, ...mapSyntxAudioSettings(entry.aiName, entry.modelType, body ?? {}) };
  if (body?.instrumental === true) providerOptions.is_instrumental = true;
  return { entry, prompt, responseFormat, settings: providerOptions };
}

export function createSyntxMusicAdapter(options = {}) {
  return {
    async: true,
    provider: SYNTX_PROVIDER_ID,
    models: syntxModelsForKind("music"),
    responseFormats: SYNTX_MEDIA_RESPONSE_FORMATS,
    async generate({ model, body, credentials, signal, log }) {
      let built;
      try {
        built = buildSyntxMusicRequest(model, body);
      } catch (error) {
        return fail(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const ctx = credentialContext(credentials, signal, options, log);
      if (!ctx) return fail(HTTP_STATUS.UNAUTHORIZED, SYNTX_MISSING_JWT);
      applySyntxProviderRules(built.entry.aiName, built.settings, { modelType: built.entry.modelType, fileCount: 0 });
      const job = await runSyntxMediaJob({
        ...ctx, scope: "audio", route: "audio", chatField: "chat_uuid", modality: "music", kindHint: "audio",
        aiName: built.entry.aiName, prompt: built.prompt, settings: built.settings,
      });
      if (!job.success) return job;
      const url = pickFirst(job.media, "audio");
      let item = { url, format: "mp3" };
      if (built.responseFormat === "b64_json") {
        const got = await downloadAll([url], { signal, options: ctx.options, modality: "music", secrets: ctx.secrets });
        if (got.failure) return got.failure;
        item = { b64_json: got.items[0].bytes.toString("base64"), format: sniffAudioFormat(got.items[0].bytes) ?? "mp3" };
      }
      const accounting = { ...job.accounting, meta: { ...job.accounting.meta, clips: 1 } };
      return { success: true, accounting, response: jsonResponse({ created: nowSec(), data: [item] }) };
    },
  };
}

// ── Transcription ───────────────────────────────────────────────

/** Source transcribeSyntxAudio answer: `text`, `data.text`, or a plain-text body. */
export function syntxTranscriptText(bodyText) {
  const json = parseJson(bodyText);
  if (json === undefined) return isString(bodyText) ? bodyText : "";
  const record = json && isObject(json) && !Array.isArray(json) ? json : {};
  if (isString(record.text) && record.text) return record.text;
  return isString(record.data?.text) ? record.data.text : "";
}

export function createSyntxSttAdapter(options = {}) {
  return {
    async: true,
    provider: SYNTX_PROVIDER_ID,
    models: syntxModelsForKind("transcription"),
    responseFormats: SYNTX_TRANSCRIPTION_RESPONSE_FORMATS,
    /** STT core contract (sttCore.js): `{ success: true, response, usageValue, nativeUnits, accounting }` or an error result. */
    async transcribe({ model, formData, credentials, kind, signal, log }) {
      if (kind === "translation") return { ...fail(HTTP_STATUS.BAD_REQUEST, "SYNTX supports transcription only, not translation"), local: true };
      if (!resolveSyntxModel(model, "transcription")) return { ...fail(HTTP_STATUS.BAD_REQUEST, "Unsupported SYNTX transcription model: use transcribe"), local: true };
      const responseFormat = formData?.get?.("response_format") || "json";
      if (!SYNTX_TRANSCRIPTION_RESPONSE_FORMATS.includes(responseFormat)) {
        return { ...fail(HTTP_STATUS.BAD_REQUEST, "SYNTX transcription supports response_format json or text"), local: true };
      }
      const file = formData?.get?.("file");
      if (!file || !isFunction(file.arrayBuffer)) return { ...fail(HTTP_STATUS.BAD_REQUEST, "Missing required field: file"), local: true };
      if (file.size > SYNTX_TRANSCRIBE_MAX_BYTES) {
        return { ...fail(HTTP_STATUS.PAYLOAD_TOO_LARGE ?? 413, `Audio too large (limit ${SYNTX_TRANSCRIBE_MAX_BYTES} bytes)`), local: true };
      }
      if (file.size === 0) return { ...fail(HTTP_STATUS.BAD_REQUEST, "Audio file is empty"), local: true };
      const ctx = credentialContext(credentials, signal, options, log);
      if (!ctx) return fail(HTTP_STATUS.UNAUTHORIZED, SYNTX_MISSING_JWT);
      const name = (isString(file.name) && file.name ? file.name : "audio.mp3").replace(/["\r\n/\\]/g, "_").slice(0, 128);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(await file.arrayBuffer())], { type: (file.type || "audio/mpeg").replace(/[\r\n]/g, "") }), name);
      const timeoutMs = options.transcribeTimeoutMs ?? SYNTX_TRANSCRIBE_TIMEOUT_MS;
      let response;
      try {
        response = await boundedFetch(options.fetchImpl ?? defaultSyntxFetch, SYNTX_TRANSCRIBE_URL, {
          method: "POST", headers: syntxApiHeaders(ctx.token), body: form,
        }, { signal, timeoutMs, credentials });
      } catch (error) {
        const status = signal?.aborted || error?.name === "AbortError" ? 499 : error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY;
        if (provenUnsent(error)) return fail(status, "SYNTX transcription could not be sent", ctx.secrets);
        return withAcceptedJob(fail(status, "SYNTX transcription was interrupted; whether it was accepted is unknown", ctx.secrets), "stt", "submit-unknown");
      }
      const away = offOrigin(response);
      if (away === "redirect") return fail(HTTP_STATUS.BAD_GATEWAY, "SYNTX transcription was redirected; the redirect was not followed", ctx.secrets);
      if (away === "foreign") return withAcceptedJob(fail(HTTP_STATUS.BAD_GATEWAY, "SYNTX transcription was answered by another origin", ctx.secrets), "stt", "submit-unknown");
      if (!response.ok) {
        const refused = await refusedAnswer(response, { signal, timeoutMs, label: "transcription", secrets: ctx.secrets });
        return response.status >= 500 ? withAcceptedJob(refused, "stt", "submit-unknown") : refused;
      }
      let bodyText;
      try {
        bodyText = await readText(response, { signal, timeoutMs, maxBytes: SYNTX_JSON_MAX_BYTES });
      } catch (error) {
        const status = signal?.aborted || error?.name === "AbortError" ? 499 : error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY;
        return withAcceptedJob(fail(status, "SYNTX transcription answer could not be read", ctx.secrets), "stt", "accepted");
      }
      const text = syntxTranscriptText(bodyText);
      const accounting = mediaAccounting(null, SYNTX_PROVIDER_ID, "stt");
      const response2 = responseFormat === "text"
        ? new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } })
        : jsonResponse({ text });
      return { success: true, response: response2, usageValue: undefined, nativeUnits: {}, accounting };
    },
  };
}
