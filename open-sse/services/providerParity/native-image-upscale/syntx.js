// SYNTX.ai upscale (Magnific / Topaz AI / Ideogram) through design generate.
//
// Source (OmniRoute c71f0065 handlers/imageUpscale/syntx.ts,
// services/syntxMedia.ts runSyntxUpscale / generateDesignWithChat /
// uploadSyntxMediaFile / pollSyntxChatMedia / fetchSyntxMediaBytes,
// services/syntxAuth.ts syntxAuthHeaders, services/syntxMediaCatalog.ts):
// 1. a data: source is uploaded (POST /api/v1/chats/upload-files, multipart
//    `files` named source.png + destination=uploaded, check_duplicates=true,
//    empty model_type) and the answer's files[0].url (or data.files[0].url)
//    is used; any other source string is passed through as the image URL;
// 2. POST /api/v1/chats `{ title, scope: "image" }` → uuid (title is the
//    prompt, whitespace-collapsed, first 60 characters);
// 3. POST /api/v1/design/generate?ai_name=<aiName> `{ chat_uuid, prompt,
//    settings }` with settings `{ model_type, image_url: [url],
//    scale_factor?, creativity?, mode: "upscale" (ideogram) }`; prompt
//    defaults to "upscale"; scale_factor / creativity only when the body
//    sent them as numbers; URLs in that answer are a fallback result;
// 4. poll GET /api/v1/chats/<uuid>/messages?page_size=50 (first wait 2 s,
//    ×1.5 up to 5 s, 600 s deadline, 5 consecutive non-2xx fail) until the
//    latest assistant message (author_id -1) has every message_object
//    completed; the first image media URL (else the first media) wins;
// 5. response_format b64_json downloads it (HTTPS, public addresses at every
//    hop, at most three redirects, 50 MiB), url returns it as-is.
// Every call carries the browser-shaped syntxAuthHeaders with the JWT.
//
// Identity: this adapter takes the already selected, scoped SYNTX credential
// `{ token }` (a raw JWT). Resolving it from a connection (apiKey,
// accessToken, providerSpecificData wrappers) belongs to the separately
// staged SYNTX identity module, which this staging does not import or edit.
//
// Fork deviations: a factor sent as anything but the number 2 or 4, a
// creativity that is not a finite number and any other factor or creativity
// alias are refused (the source silently dropped them); a remote source must
// be https on a public literal host without userinfo (SYNTX fetches it; the
// gateway never does); inline sources must be data: URIs that sniff as PNG,
// JPEG or WebP within 50 MiB (bare base64 was passed on as a URL by the
// source and is refused). The upload / result URLs must be https on a public
// host. The upstream body is never quoted. The upscale is billable from the
// generate submit on: a submit whose outcome is unknown and every later
// failure carry `acceptedJob` with the chat uuid, and nothing is resent. The
// reported factor is the one sent, or null when SYNTX chose (the source
// reported 2). A b64_json result must sniff as an image.
import { randomBytes } from "node:crypto";
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { guardedProbeFetch } from "../../../utils/outboundUrlGuard.js";
import { fetchPublic } from "../../../../src/shared/utils/ssrfGuard.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  IMAGE_MIMES, JSON_MAX_BYTES, SUBMIT_TIMEOUT_MS, SYNTX_CHATS_URL, SYNTX_CHAT_SCOPE, SYNTX_DEFAULT_PROMPT, SYNTX_DOWNLOAD_MAX_REDIRECTS,
  SYNTX_DOWNLOAD_TIMEOUT_MS, SYNTX_MEDIA_MAX_BYTES, SYNTX_ORIGIN, SYNTX_POLL_INTERVAL_MS, SYNTX_POLL_MAX_ERRORS, SYNTX_POLL_TIMEOUT_MS,
  SYNTX_PROVIDER_ID, SYNTX_SITE, SYNTX_UPLOAD_FILENAME, SYNTX_UPLOAD_MAX_BYTES, SYNTX_UPLOAD_URL, SYNTX_USER_AGENT, UPSCALE_PROVIDERS,
  syntxDesignGenerateUrl, syntxMessagesUrl,
} from "./config.js";
import {
  abortableSleep, boundedFetch, discard, offOrigin, readBoundedBytes, readBoundedJson, refusedAnswer, sendFailure, withAcceptedJob,
} from "./http.js";
import { decodeInlineImage, extractUpscaleSourceImage, isRemoteReference, parsePublicHttpUrl, reject, sniffUpscaleImage } from "./media.js";
import { COMMON_FIELDS, assertKnownFields, parseEnvelope, parseFactor, parsePrompt, present } from "./request.js";
import { upscaleSuccess } from "./result.js";

const LABEL = "SYNTX upscale";
const JWT_RE = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const CHAT_UUID_RE = /^[A-Za-z0-9-]{1,64}$/;
const MEDIA_OBJECT_TYPES = new Set(["image", "video", "audio", "file"]);
const PREFERRED_URL_KEYS = ["object_url", "url", "image_url", "video_url", "audio_url", "file_url", "download_url"];

/** The scoped JWT, or null. Only `{ token }` is read; nothing is resolved here. */
export function syntxScopedToken(credentials) {
  const token = isString(credentials?.token) ? credentials.token.trim() : "";
  return JWT_RE.test(token) ? token : null;
}

/** Source syntxAuthHeaders. */
export const syntxAuthHeaders = (token) => ({
  accept: "application/json, text/plain, */*",
  "accept-language": "en",
  authorization: `Bearer ${token}`,
  origin: "https://syntx.ai",
  referer: SYNTX_SITE,
  "user-agent": SYNTX_USER_AGENT,
});

/** Source chatTitleFromText. */
export function syntxChatTitle(text) {
  const trimmed = (text || "media").replace(/\s+/g, " ").trim();
  return trimmed.slice(0, 60) || "media";
}

/** Validate an upscale body for a SYNTX upscale row. Throws 400 before any network call. */
export function parseSyntxUpscaleRequest(model, body) {
  const entry = UPSCALE_PROVIDERS[SYNTX_PROVIDER_ID].models.find((row) => row.id === model);
  if (!entry) throw reject(`Unsupported SYNTX upscale model: ${model}`);
  assertKnownFields(body, new Set([...COMMON_FIELDS, "factor", "creativity", "prompt"]), LABEL);
  const responseFormat = parseEnvelope(body, LABEL);
  const source = extractUpscaleSourceImage(body, "SYNTX upscale");
  const factor = parseFactor(body, entry, { fields: ["factor"], numberOnly: true, label: LABEL });
  let creativity = null;
  if (present(body.creativity)) {
    if (!isNumber(body.creativity) || !Number.isFinite(body.creativity)) throw reject(`${LABEL} creativity must be a number`);
    creativity = body.creativity;
  }
  const prompt = parsePrompt(body) || SYNTX_DEFAULT_PROMPT;
  let image;
  if (isRemoteReference(source)) {
    const url = parsePublicHttpUrl(source, { httpsOnly: true });
    if (!url) throw reject("SYNTX upscale source URL must be https on a public host without credentials");
    image = { url: url.toString() };
  } else {
    if (!source.toLowerCase().startsWith("data:")) throw reject("SYNTX upscale takes a data: URI or an https image URL");
    image = { inline: decodeInlineImage(source, SYNTX_MEDIA_MAX_BYTES) };
  }
  const settings = { model_type: entry.modelType, image_url: [] };
  if (factor !== null) settings.scale_factor = factor;
  if (creativity !== null) settings.creativity = creativity;
  if (entry.aiName === "ideogram") settings.mode = "upscale";
  return { model, entry, image, prompt, factor, creativity, settings, responseFormat };
}

/** Source encodeUploadMultipart, byte for byte. */
export function encodeSyntxUploadMultipart({ bytes, name, mime }, boundary = `----WebKitFormBoundary${randomBytes(8).toString("hex")}`) {
  const safeName = name.replace(/["\r\n]/g, "_") || "upload.bin";
  const safeMime = mime.replace(/[\r\n]/g, "") || "application/octet-stream";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${safeName}"\r\nContent-Type: ${safeMime}\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="destination"\r\n\r\nuploaded\r\n--${boundary}\r\nContent-Disposition: form-data; name="check_duplicates"\r\n\r\ntrue\r\n--${boundary}\r\nContent-Disposition: form-data; name="model_type"\r\n\r\n\r\n--${boundary}--\r\n`,
    ),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Source collectSyntxCompletedMedia. */
export function collectSyntxCompletedMedia(message) {
  const objects = isRecord(message) && Array.isArray(message.message_object) ? message.message_object : [];
  if (objects.length === 0) return { media: [], ready: false };
  const ready = objects.every((item) => isRecord(item) && item.completed === true);
  const media = [];
  for (const item of objects) {
    if (!isRecord(item)) continue;
    const type = isString(item.object_type) ? item.object_type : "";
    if (MEDIA_OBJECT_TYPES.has(type) && isString(item.object_url) && item.object_url) media.push({ objectType: type, url: item.object_url });
  }
  return { media, ready };
}

/** Source extractUrlsDeep over the generate answer (fallback result URLs). */
export function extractSyntxImmediateUrls(value, into = [], depth = 0) {
  if (!value || depth > 16) return into;
  const push = (url) => {
    if (/^https?:\/\//i.test(url) && !into.some((item) => item.url === url)) into.push({ objectType: "image", url });
  };
  if (isString(value)) {
    if (!value.includes("syntx.ai/api/")) push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractSyntxImmediateUrls(item, into, depth + 1);
    return into;
  }
  if (isRecord(value)) {
    for (const key of PREFERRED_URL_KEYS) if (isString(value[key])) push(value[key]);
    for (const nested of Object.values(value)) if (isRecord(nested) || Array.isArray(nested)) extractSyntxImmediateUrls(nested, into, depth + 1);
  }
  return into;
}

/**
 * @param {object} [options] - { fetchImpl (SYNTX API), downloadFetchImpl (result URL under the public-only guard),
 *   submitTimeoutMs, pollTimeoutMs, pollIntervalMs, downloadTimeoutMs, now, sleep, boundary }
 */
export function createSyntxUpscaleAdapter(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args), downloadFetchImpl = (...args) => globalThis.fetch(...args),
    submitTimeoutMs = SUBMIT_TIMEOUT_MS, pollTimeoutMs = SYNTX_POLL_TIMEOUT_MS, pollIntervalMs = SYNTX_POLL_INTERVAL_MS,
    downloadTimeoutMs = SYNTX_DOWNLOAD_TIMEOUT_MS, now = Date.now, sleep = abortableSleep, boundary,
  } = options;
  const provider = SYNTX_PROVIDER_ID;

  /** One SYNTX API call; returns { response } or { failure } (never billable). */
  async function call(url, init, { signal, label }) {
    try {
      const response = await boundedFetch(fetchImpl, url, { ...init, redirect: "manual" }, { signal, timeoutMs: submitTimeoutMs });
      if (offOrigin(response, SYNTX_ORIGIN)) {
        discard(response);
        return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, `SYNTX ${label} was redirected (refused)`) };
      }
      return { response };
    } catch (error) {
      return { failure: sendFailure(error, { provider, label: `SYNTX ${label}`, signal, billable: false }) };
    }
  }

  async function readJson(response, signal) {
    return readBoundedJson(response, { signal, timeoutMs: submitTimeoutMs, maxBytes: JSON_MAX_BYTES });
  }

  async function upload(token, inline, { signal, credentials }) {
    const encoded = encodeSyntxUploadMultipart({ bytes: inline.bytes, name: SYNTX_UPLOAD_FILENAME, mime: inline.mime }, boundary);
    if (inline.bytes.byteLength > SYNTX_UPLOAD_MAX_BYTES) return { failure: createErrorResult(HTTP_STATUS.BAD_REQUEST, "SYNTX upload is too large") };
    const headers = syntxAuthHeaders(token);
    const sent = await call(SYNTX_UPLOAD_URL, {
      method: "POST",
      headers: {
        authorization: headers.authorization, accept: headers.accept, origin: headers.origin, referer: headers.referer,
        "user-agent": headers["user-agent"], "accept-language": headers["accept-language"], "content-type": encoded.contentType,
      },
      body: encoded.body,
    }, { signal, credentials, label: "source upload" });
    if (sent.failure) return sent;
    if (!sent.response.ok) {
      if (sent.response.status === 401 || sent.response.status === 403) return { failure: refusedAnswer(sent.response, { provider, label: "SYNTX", credentials, billable: false }) };
      discard(sent.response);
      return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SYNTX rejected the upscale source upload") };
    }
    let json;
    try {
      json = await readJson(sent.response, signal);
    } catch {
      return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SYNTX upload answer was unreadable") };
    }
    const files = Array.isArray(json?.files) ? json.files : Array.isArray(json?.data?.files) ? json.data.files : [];
    const url = isRecord(files[0]) && isString(files[0].url) ? parsePublicHttpUrl(files[0].url, { httpsOnly: true }) : null;
    if (!url) return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SYNTX rejected the upscale source upload") };
    return { url: url.toString() };
  }

  async function createChat(token, title, { signal, credentials }) {
    const sent = await call(SYNTX_CHATS_URL, {
      method: "POST",
      headers: { ...syntxAuthHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ title: syntxChatTitle(title), scope: SYNTX_CHAT_SCOPE }),
    }, { signal, credentials, label: "create chat" });
    if (sent.failure) return sent;
    if (!sent.response.ok) return { failure: refusedAnswer(sent.response, { provider, label: "SYNTX", credentials, billable: false }) };
    let json;
    try {
      json = await readJson(sent.response, signal);
    } catch {
      return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SYNTX create chat answer was unreadable") };
    }
    const uuid = isRecord(json) && isString(json.uuid) ? json.uuid : "";
    if (!CHAT_UUID_RE.test(uuid)) return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SYNTX create chat returned no uuid") };
    return { uuid };
  }

  async function poll(token, chatUuid, { signal, credentials }) {
    const lost = (status, message) => ({ failure: withAcceptedJob(createErrorResult(status, message), provider, "accepted", { chatUuid }) });
    const started = now();
    let interval = Math.max(Math.floor(pollIntervalMs * 0.4), Math.min(1000, pollIntervalMs));
    let errors = 0;
    for (;;) {
      if (signal?.aborted) return lost(499, "SYNTX media wait cancelled");
      if (now() - started > pollTimeoutMs) return lost(HTTP_STATUS.GATEWAY_TIMEOUT, "Timeout waiting for SYNTX upscale media");
      let response;
      try {
        response = await boundedFetch(fetchImpl, syntxMessagesUrl(chatUuid), {
          method: "GET", headers: syntxAuthHeaders(token), redirect: "manual",
        }, { signal, timeoutMs: Math.max(1, Math.min(submitTimeoutMs, pollTimeoutMs - (now() - started))) });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return lost(499, "SYNTX media wait cancelled");
        return lost(error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY, "SYNTX upscale poll failed");
      }
      if (offOrigin(response, SYNTX_ORIGIN)) {
        discard(response);
        return lost(HTTP_STATUS.BAD_GATEWAY, "SYNTX poll was redirected (refused)");
      }
      if (!response.ok) {
        discard(response);
        errors += 1;
        if (errors >= SYNTX_POLL_MAX_ERRORS) return lost(HTTP_STATUS.BAD_GATEWAY, `SYNTX poll messages HTTP ${response.status}`);
      } else {
        errors = 0;
        let json;
        try {
          json = await readJson(response, signal);
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") return lost(499, "SYNTX media wait cancelled");
          json = null;
        }
        const messages = Array.isArray(json?.messages) ? json.messages : Array.isArray(json) ? json : [];
        const latest = messages.filter((item) => isRecord(item) && item.author_id === -1).at(-1);
        if (latest) {
          const projection = collectSyntxCompletedMedia(latest);
          if (projection.ready) return { media: projection.media };
        }
      }
      try {
        await sleep(interval, signal);
      } catch {
        return lost(499, "SYNTX media wait cancelled");
      }
      interval = Math.min(pollIntervalMs, Math.floor(interval * 1.5));
    }
  }

  async function download(url, { signal, chatUuid }) {
    const lost = (status, message) => withAcceptedJob(createErrorResult(status, message), provider, "accepted", { chatUuid });
    let response;
    try {
      response = await boundedFetch((target, init) => fetchPublic(target, init, {
        maxRedirects: SYNTX_DOWNLOAD_MAX_REDIRECTS,
        fetchImpl: (hop, hopInit) => {
          if (!parsePublicHttpUrl(String(hop), { httpsOnly: true })) throw new Error("non-https hop");
          return guardedProbeFetch(hop, hopInit, "public-only", downloadFetchImpl);
        },
      }), url, { method: "GET", headers: { Accept: "image/*" }, credentials: "omit" }, { signal, timeoutMs: downloadTimeoutMs });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return { failure: lost(499, "SYNTX media download cancelled") };
      return { failure: lost(error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY, "Failed to download SYNTX media") };
    }
    if (!response.ok) {
      discard(response);
      return { failure: lost(HTTP_STATUS.BAD_GATEWAY, `Failed to download SYNTX media HTTP ${response.status}`) };
    }
    try {
      const bytes = await readBoundedBytes(response, { signal, timeoutMs: downloadTimeoutMs, maxBytes: SYNTX_MEDIA_MAX_BYTES });
      return { bytes };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return { failure: lost(499, "SYNTX media download cancelled") };
      return { failure: lost(HTTP_STATUS.BAD_GATEWAY, error?.tooLarge ? `SYNTX media exceeds ${SYNTX_MEDIA_MAX_BYTES} byte limit` : "Failed to download SYNTX media") };
    }
  }

  return {
    provider,
    format: UPSCALE_PROVIDERS[provider].format,
    models: UPSCALE_PROVIDERS[provider].models,
    /** `credentials` is the selected, scoped SYNTX credential `{ token }`. */
    async upscale({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = parseSyntxUpscaleRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = syntxScopedToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Missing SYNTX JWT — paste the Authorization Bearer token from syntx.ai");
      const ctx = { signal, credentials };

      let imageUrl = request.image.url;
      if (!imageUrl) {
        const uploaded = await upload(token, request.image.inline, ctx);
        if (uploaded.failure) return uploaded.failure;
        imageUrl = uploaded.url;
      }
      const chat = await createChat(token, request.prompt, ctx);
      if (chat.failure) return chat.failure;
      const chatUuid = chat.uuid;
      const settings = { ...request.settings, image_url: [imageUrl] };

      let response;
      try {
        response = await boundedFetch(fetchImpl, syntxDesignGenerateUrl(request.entry.aiName), {
          method: "POST",
          headers: { ...syntxAuthHeaders(token), "content-type": "application/json" },
          body: JSON.stringify({ chat_uuid: chatUuid, prompt: request.prompt, settings }),
          redirect: "manual",
        }, { signal, timeoutMs: submitTimeoutMs });
      } catch (error) {
        const failure = sendFailure(error, { provider, label: "SYNTX", signal });
        return failure.acceptedJob ? { ...failure, acceptedJob: { ...failure.acceptedJob, meta: { ...failure.acceptedJob.meta, chatUuid } } } : failure;
      }
      if (offOrigin(response, SYNTX_ORIGIN)) {
        discard(response);
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SYNTX upscale submit was redirected (refused)"), provider, "submit-unknown", { chatUuid });
      }
      if (!response.ok) {
        const refused = refusedAnswer(response, { provider, label: "SYNTX", credentials });
        return refused.acceptedJob ? { ...refused, acceptedJob: { ...refused.acceptedJob, meta: { ...refused.acceptedJob.meta, chatUuid } } } : refused;
      }
      let immediate = [];
      try {
        immediate = extractSyntxImmediateUrls(await readJson(response, signal));
      } catch {
        immediate = [];
      }

      const polled = await poll(token, chatUuid, ctx);
      if (polled.failure) return polled.failure;
      const media = polled.media.length === 0 && immediate.length > 0 ? immediate : polled.media;
      const chosen = media.find((item) => item.objectType === "image") ?? media[0];
      const resultUrl = chosen ? parsePublicHttpUrl(chosen.url, { httpsOnly: true }) : null;
      if (!resultUrl) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
          chosen ? "SYNTX upscale result URL was refused (not https on a public host)" : "SYNTX upscale completed without an image URL"),
        provider, "accepted", { chatUuid });
      }
      let image;
      let meta = { factor: request.factor };
      if (request.responseFormat === "b64_json") {
        const fetched = await download(resultUrl.toString(), { signal, chatUuid });
        if (fetched.failure) return fetched.failure;
        const format = sniffUpscaleImage(fetched.bytes);
        if (!format) {
          return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SYNTX upscale media is not a PNG, JPEG or WebP image"), provider, "accepted", { chatUuid });
        }
        image = { b64_json: Buffer.from(fetched.bytes).toString("base64") };
        meta = { ...meta, output_format: format, mime: IMAGE_MIMES[format] };
      } else {
        image = { url: chosen.url };
      }
      log?.info?.("IMAGE", `SYNTX upscaled via ${model}`);
      return upscaleSuccess({ provider, model, now, images: [image], meta, accountingMeta: { chatUuid } });
    },
  };
}
