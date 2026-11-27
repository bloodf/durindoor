// Agnes native image generation: one synchronous POST to
// https://apihub.agnes-ai.com/v1/images/generations. Staged for
// /v1/images/generations as a guarded `generate` adapter and not registered
// (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`agnes`, format "agnes-image") and
// open-sse/handlers/imageGeneration.ts (the required `size` check,
// buildAgnesImageRequestBody: `{ model, prompt, size, ratio, return_base64,
// extra_body: { ...extra_body, image: [inputs], response_format } }` with
// `ratio` falling back to `aspect_ratio` and inputs gathered by
// extractImageInputs; Bearer key; OpenAI `data[]` answer whose items need a
// `url` or `b64_json`), via handlers/imageGeneration/openAiImageFetch.ts.
//
// Fork deviations: the key goes only to the fixed Agnes origin; the call is
// time bounded, aborts on the caller's signal and refuses redirects; the
// answer is size bounded and never quoted in an error; `size` must be one of
// the registry's 1K/2K/3K/4K; n > 1, masks, OpenAI quality/style/output
// options, streaming and binary output are refused instead of dropped; input
// images must be public https URLs or bounded base64 data URIs (Agnes fetches
// them, the gateway never does); a requested response_format must be the one
// returned (a URL is never downloaded and base64 is never re-hosted); result
// URLs must be public https; a send whose outcome is unknown carries
// `acceptedJob` and is never resent.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { MAX_IMAGE_BYTES } from "../../../config/mediaConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBoolean, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  AGNES_IMAGE_MAX_INPUTS, AGNES_IMAGE_MODELS, AGNES_IMAGE_SIZES, AGNES_IMAGE_TIMEOUT_MS, AGNES_IMAGE_URL,
  AGNES_PROVIDER_ID, agnesImageModel,
} from "./config.js";
import {
  agnesHeaders, agnesPublicUrl, agnesSecrets, agnesToken, boundedFetch, provenUnsent, readJsonObject,
  redirectState, refusedAnswer, withAcceptedJob,
} from "./http.js";

const MODALITY = "image";
const RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_PROMPT_CHARS = 32_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URI_RE = /^data:image\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/;
const RATIO_RE = /^\d{1,3}:\d{1,3}$/;
// OpenAI Images fields Agnes does not take; the source dropped them silently.
const REFUSED_FIELDS = ["mask", "mask_url", "quality", "style", "output_format", "output_compression", "background", "moderation"];

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "Agnes image request aborted");
const decodedBytes = (b64) => Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

/** A reference image Agnes may fetch: a public https URL or a bounded base64 data URI. */
function checkedInput(raw) {
  const value = raw.trim();
  const data = DATA_URI_RE.exec(value);
  if (data) {
    if (decodedBytes(data[1]) > MAX_IMAGE_BYTES) throw reject("Agnes input image is too large");
    return value;
  }
  if (value.startsWith("data:")) throw reject("Agnes input images must be base64 image data URIs or https URLs");
  if (!agnesPublicUrl(value)) throw reject("Agnes input image URLs must be public https URLs");
  return value;
}

/** The source's extractImageInputs: image_url, image, imageUrls, image_urls, chat image parts; deduplicated. */
function imageInputs(body) {
  const seen = new Set();
  const out = [];
  const push = (candidate, field) => {
    if (candidate === undefined || candidate === null) return;
    if (!isString(candidate)) throw reject(`${field} must be a string image URL`);
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(checkedInput(trimmed));
  };
  push(body.image_url, "image_url");
  push(body.image, "image");
  for (const field of ["imageUrls", "image_urls"]) {
    if (body[field] === undefined) continue;
    if (!Array.isArray(body[field])) throw reject(`${field} must be an array of image URLs`);
    for (const candidate of body[field]) push(candidate, field);
  }
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!Array.isArray(message?.content)) continue;
      for (const part of message.content) if (part?.type === "image_url") push(part?.image_url?.url, "image_url part");
    }
  }
  if (out.length > AGNES_IMAGE_MAX_INPUTS) throw reject(`Agnes takes at most ${AGNES_IMAGE_MAX_INPUTS} input images`);
  return out;
}

/**
 * The Agnes body for an OpenAI-style image request. Throws a 400 error for an
 * unknown model or an input this subset cannot honor.
 */
export function buildAgnesImageRequest(model, body) {
  if (!agnesImageModel(model)) throw reject(`Unsupported Agnes image model: ${model}. Use one of: ${AGNES_IMAGE_MODELS.map((m) => m.id).join(", ")}`);
  if (!isRecord(body)) throw reject("Agnes image generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Agnes image generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`Agnes image prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (!isString(body.size) || !body.size.trim()) throw reject(`size is required for Agnes image generation (one of ${AGNES_IMAGE_SIZES.join(", ")})`);
  if (!AGNES_IMAGE_SIZES.includes(body.size)) throw reject(`Agnes image size must be one of: ${AGNES_IMAGE_SIZES.join(", ")}`);
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw reject("Agnes image generation returns one image per request (n=1)");
  if (body.stream) throw reject("Agnes image generation does not support streaming");
  const refused = REFUSED_FIELDS.find((field) => body[field] !== undefined && body[field] !== null);
  if (refused) throw reject(`Agnes image generation does not support ${refused}`);
  if (body.response_format !== undefined && !RESPONSE_FORMATS.includes(body.response_format)) {
    throw reject(`Agnes image supports response_format ${RESPONSE_FORMATS.join(", ")} only`);
  }
  if (body.return_base64 !== undefined && !isBoolean(body.return_base64)) throw reject("return_base64 must be a boolean");
  if (body.extra_body !== undefined && !isRecord(body.extra_body)) throw reject("extra_body must be a JSON object");

  const request = { model, prompt: body.prompt, size: body.size };
  const ratio = body.ratio !== undefined ? body.ratio : body.aspect_ratio;
  if (ratio !== undefined) {
    if (!isString(ratio) || !RATIO_RE.test(ratio)) throw reject("ratio must look like 16:9");
    request.ratio = ratio;
  }
  if (body.return_base64 !== undefined) request.return_base64 = body.return_base64;

  const extraBody = { ...(body.extra_body ?? {}) };
  if (extraBody.image !== undefined) {
    if (!Array.isArray(extraBody.image) || extraBody.image.some((item) => !isString(item))) throw reject("extra_body.image must be an array of image URLs");
    extraBody.image = extraBody.image.map(checkedInput);
  }
  const inputs = imageInputs(body);
  if (inputs.length > 0) extraBody.image = inputs;
  if (body.response_format !== undefined) extraBody.response_format = body.response_format;
  if (Object.keys(extraBody).length > 0) request.extra_body = extraBody;
  return request;
}

/**
 * Keep only usable items: a public https `url` or a bounded `b64_json`, plus a
 * short `revised_prompt`. Items of the wrong form for a requested format are
 * not usable either.
 */
function normalizeItems(items, requested) {
  const kept = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isRecord(item)) continue;
    const out = {};
    if (isString(item.b64_json) && item.b64_json && BASE64_RE.test(item.b64_json) && decodedBytes(item.b64_json) <= MAX_IMAGE_BYTES) {
      out.b64_json = item.b64_json;
    } else if (isString(item.url) && agnesPublicUrl(item.url)) {
      out.url = agnesPublicUrl(item.url);
    } else {
      continue;
    }
    if (requested === "url" && !out.url) continue;
    if (requested === "b64_json" && !out.b64_json) continue;
    if (isString(item.revised_prompt) && item.revised_prompt.length <= MAX_PROMPT_CHARS) out.revised_prompt = item.revised_prompt;
    kept.push(out);
  }
  return kept;
}

/**
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - bound for the whole call, headers and body
 */
export function createAgnesImageAdapter({ timeoutMs = AGNES_IMAGE_TIMEOUT_MS, now = Date.now } = {}) {
  return {
    provider: AGNES_PROVIDER_ID,
    models: AGNES_IMAGE_MODELS,
    supportedSizes: AGNES_IMAGE_SIZES,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate one image for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url } | { b64_json }] }`, or an error result that
     * carries `acceptedJob` when Agnes may have run (and billed) the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildAgnesImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = agnesToken(credentials);
      if (!token) return createErrorResult(401, "Agnes API key is required");
      if (signal?.aborted) return abortedResult();
      const secrets = agnesSecrets(credentials);
      const deadline = now() + timeoutMs;
      const remaining = () => Math.max(1, deadline - now());

      let response;
      try {
        response = await boundedFetch(AGNES_IMAGE_URL, {
          method: "POST",
          headers: agnesHeaders(token),
          body: JSON.stringify(request),
          redirect: "manual",
          proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: remaining() });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), MODALITY, "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Agnes image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `Agnes image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`
        ), MODALITY, "submit-unknown");
      }

      const redirect = redirectState(response);
      if (redirect?.refused) {
        log?.debug?.("AGNES_IMAGE", "image request redirect refused");
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Agnes image request redirect refused");
      }
      if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Agnes image request was redirected"), MODALITY, "submit-unknown");
      if (!response.ok) return refusedAnswer(response, { modality: MODALITY, label: "image generation", signal, timeoutMs: remaining(), secrets });

      let answer;
      try {
        answer = await readJsonObject(response, { signal, timeoutMs: remaining(), maxBytes: MAX_RESPONSE_BYTES, what: "image answer" });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), MODALITY, "completed-unread");
        return withAcceptedJob(createErrorResult(error?.status ?? HTTP_STATUS.BAD_GATEWAY, error.message), MODALITY, "completed-unread");
      }
      const data = normalizeItems(answer.data, body.response_format);
      if (data.length === 0) {
        // A 2xx answer may already be billed even without a usable image.
        return withAcceptedJob(
          createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Agnes returned no usable image${body.response_format ? ` in response_format ${body.response_format}` : ""}`),
          MODALITY,
          "completed-unusable"
        );
      }
      const payload = { created: Number.isInteger(answer.created) ? answer.created : Math.floor(Date.now() / 1000), data };
      const accounting = mediaAccounting(answer, AGNES_PROVIDER_ID, MODALITY);
      returnedImageUnits(accounting, payload);
      return {
        success: true,
        accounting,
        response: new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    },
  };
}
