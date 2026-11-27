// Pollinations native image generation: one synchronous POST to
// https://gen.pollinations.ai/v1/images/generations. Staged for
// /v1/images/generations as a guarded `generate` adapter and not registered
// (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`pollinations`, format "openai") and
// open-sse/handlers/imageGeneration.ts handleOpenAIImageGeneration: body
// `{ model, prompt, ...output options, n, size, quality, response_format, style }`
// with each optional field forwarded only when given, output options validated
// by handlers/imageGeneration/generationOptions.ts (non-openai providers get
// only the output_format / frame controls), `image_url` set from the first
// reference image for ids in OPENAI_IMAGE_TO_IMAGE_MODELS (here only
// `qwen-image`), `Authorization: Bearer <key>` when the connection has a key,
// and an OpenAI `data[]` answer whose items need a `url` or `b64_json` (an
// empty 2xx is a 502) via handlers/imageGeneration/openAiImageFetch.ts.
//
// Not ported: the keyless fingerprint-pool fallback in
// handlers/imageGeneration/pollinationsAnonAuth.ts (#8085). This fork has no
// session-pool service, and a keyless request is sent without credentials, as
// the local chat executor (open-sse/executors/pollinations.js) does.
//
// Fork deviations: the key goes only to the fixed Pollinations origin; the
// call is time bounded, aborts on the caller's signal and refuses redirects;
// the answer is size bounded and never quoted in an error; the model must be
// one of the eight catalog ids and `size` one of the registry's
// supportedSizes; `n` must be an integer 1..10; masks, streaming, binary
// output and reference images other than one public https URL for
// `qwen-image` are refused instead of dropped; a requested response_format
// must be the one returned (a URL is never downloaded and base64 is never
// re-hosted); result URLs must be public https; a send whose outcome is
// unknown carries `acceptedJob` and is never resent; keyless refusals never
// mark the shared public credential as out of quota.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { MAX_IMAGE_BYTES } from "../../../config/mediaConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { prepareImageOutputOptions } from "../../../handlers/imageProviders/outputFormat.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  POLLINATIONS_IMAGE_MAX_N, POLLINATIONS_IMAGE_MODELS, POLLINATIONS_IMAGE_SIZES, POLLINATIONS_IMAGE_TIMEOUT_MS,
  POLLINATIONS_IMAGE_URL, POLLINATIONS_PROVIDER_ID, POLLINATIONS_RESPONSE_FORMATS, pollinationsImageModel,
} from "./config.js";
import {
  boundedFetch, pollinationsAuth, pollinationsHeaders, pollinationsPublicUrl, pollinationsSecrets, provenUnsent,
  readJsonObject, redirectState, refusedAnswer, withAcceptedJob,
} from "./http.js";

const MODALITY = "image";
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_PROMPT_CHARS = 32_000;
const MAX_STRING_OPTION = 64;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MASK_FIELDS = ["mask", "mask_url"];
// Edit-style inputs the source never forwarded for any Pollinations model.
const UNSUPPORTED_IMAGE_FIELDS = ["images", "input_image"];

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "Pollinations image request aborted");
const decodedBytes = (b64) => Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
const present = (value) => value !== undefined && value !== null;

function shortOption(body, field) {
  if (!present(body[field])) return undefined;
  if (!isString(body[field]) || !body[field].trim() || body[field].length > MAX_STRING_OPTION) throw reject(`${field} must be a short string`);
  return body[field];
}

/**
 * Reference images in the source's extractImageInputs order (image_url,
 * image, imageUrls, image_urls, chat image_url parts), de-duplicated.
 * Non-string entries are refused rather than skipped.
 */
function referenceImages(body) {
  const found = [];
  const push = (value, field) => {
    if (!isString(value) || !value.trim()) throw reject(`${field} must be an image URL string`);
    if (!found.includes(value.trim())) found.push(value.trim());
  };
  if (present(body.image_url)) push(body.image_url, "image_url");
  if (present(body.image)) push(body.image, "image");
  for (const field of ["imageUrls", "image_urls"]) {
    if (!present(body[field])) continue;
    if (!Array.isArray(body[field])) throw reject(`${field} must be an array of image URLs`);
    for (const value of body[field]) push(value, field);
  }
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!Array.isArray(message?.content)) continue;
      for (const part of message.content) if (part?.type === "image_url") push(part?.image_url?.url, "image_url part");
    }
  }
  return found;
}

/**
 * The Pollinations body for an OpenAI-style image request. Throws a 400 error
 * for an unknown model or an input this subset cannot honor.
 */
export function buildPollinationsImageRequest(model, body) {
  const entry = pollinationsImageModel(model);
  if (!entry) {
    throw reject(`Unsupported Pollinations image model: ${model}. Use one of: ${POLLINATIONS_IMAGE_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("Pollinations image generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Pollinations image generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`Pollinations image prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.stream) throw reject("Pollinations image generation does not support streaming");
  const mask = MASK_FIELDS.find((field) => present(body[field]));
  if (mask) throw reject(`Pollinations image generation does not support ${mask}`);
  const unsupported = UNSUPPORTED_IMAGE_FIELDS.find((field) => present(body[field]));
  if (unsupported) throw reject(`Pollinations image generation does not support ${unsupported}`);

  const references = referenceImages(body);
  let imageUrl;
  if (references.length > 0) {
    if (!entry.inputModalities.includes("image")) {
      throw reject(`Pollinations model ${model} is text-to-image only; reference images need qwen-image`);
    }
    if (references.length > 1) throw reject(`Pollinations ${model} accepts one reference image`);
    imageUrl = pollinationsPublicUrl(references[0]);
    if (!imageUrl) throw reject("Pollinations reference images must be a public https URL");
  }
  if (present(body.n) && !(Number.isInteger(body.n) && body.n >= 1 && body.n <= POLLINATIONS_IMAGE_MAX_N)) {
    throw reject(`n must be an integer from 1 to ${POLLINATIONS_IMAGE_MAX_N}`);
  }
  if (present(body.size) && !POLLINATIONS_IMAGE_SIZES.includes(body.size)) {
    throw reject(`Pollinations image size must be one of: ${POLLINATIONS_IMAGE_SIZES.join(", ")}`);
  }
  if (present(body.response_format) && !POLLINATIONS_RESPONSE_FORMATS.includes(body.response_format)) {
    throw reject(`Pollinations image supports response_format ${POLLINATIONS_RESPONSE_FORMATS.join(", ")} only`);
  }
  const quality = shortOption(body, "quality");
  const style = shortOption(body, "style");
  // The source's non-openai option set: output_format and the GIF frame controls.
  const output = prepareImageOutputOptions(body);

  const request = { model, prompt: body.prompt, ...output };
  if (present(body.n)) request.n = body.n;
  if (present(body.size)) request.size = body.size;
  if (quality !== undefined) request.quality = quality;
  if (present(body.response_format)) request.response_format = body.response_format;
  if (style !== undefined) request.style = style;
  if (imageUrl) request.image_url = imageUrl;
  return request;
}

/**
 * Keep only usable items: a bounded `b64_json` or a public https `url`, plus
 * a short `revised_prompt`. Items of the wrong form for a requested format
 * are not usable either.
 */
function normalizeItems(items, requested) {
  const kept = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isRecord(item)) continue;
    const out = {};
    if (isString(item.b64_json) && item.b64_json && BASE64_RE.test(item.b64_json) && decodedBytes(item.b64_json) <= MAX_IMAGE_BYTES) {
      out.b64_json = item.b64_json;
    } else if (isString(item.url) && pollinationsPublicUrl(item.url)) {
      out.url = pollinationsPublicUrl(item.url);
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
 * @param {() => number} [options.now] - clock, for tests
 */
export function createPollinationsImageAdapter({ timeoutMs = POLLINATIONS_IMAGE_TIMEOUT_MS, now = Date.now } = {}) {
  return {
    provider: POLLINATIONS_PROVIDER_ID,
    format: "openai",
    models: POLLINATIONS_IMAGE_MODELS,
    supportedSizes: POLLINATIONS_IMAGE_SIZES,
    responseFormats: POLLINATIONS_RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate images for the selected connection, or keylessly for the
     * public no-auth credential.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url } | { b64_json }] }`, or an error result that
     * carries `acceptedJob` when Pollinations may have run (and billed) the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildPollinationsImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const auth = pollinationsAuth(credentials);
      if (auth.mode === "invalid") return createErrorResult(401, "Pollinations API key is not usable");
      const anonymous = auth.mode === "anonymous";
      const authScope = anonymous ? "anonymous" : "apikey";
      if (signal?.aborted) return abortedResult();
      const secrets = pollinationsSecrets(credentials);
      const deadline = now() + timeoutMs;
      const remaining = () => Math.max(1, deadline - now());

      let response;
      try {
        response = await boundedFetch(POLLINATIONS_IMAGE_URL, {
          method: "POST",
          headers: pollinationsHeaders(auth),
          body: JSON.stringify(request),
          redirect: "manual",
          proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: remaining() });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") {
          return unsent ? abortedResult() : withAcceptedJob(abortedResult(), MODALITY, "submit-unknown", authScope);
        }
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Pollinations image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `Pollinations image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`
        ), MODALITY, "submit-unknown", authScope);
      }

      const redirect = redirectState(response);
      if (redirect?.refused) {
        log?.debug?.("POLLINATIONS_IMAGE", "image request redirect refused");
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Pollinations image request redirect refused");
      }
      if (redirect?.foreign) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Pollinations image request was redirected"), MODALITY, "submit-unknown", authScope);
      }
      if (!response.ok) {
        return refusedAnswer(response, { modality: MODALITY, label: "image generation", signal, timeoutMs: remaining(), secrets, anonymous });
      }

      let answer;
      try {
        answer = await readJsonObject(response, { signal, timeoutMs: remaining(), maxBytes: MAX_RESPONSE_BYTES, what: "image answer" });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), MODALITY, "completed-unread", authScope);
        return withAcceptedJob(createErrorResult(error?.status ?? HTTP_STATUS.BAD_GATEWAY, error.message), MODALITY, "completed-unread", authScope);
      }
      const data = normalizeItems(answer.data, body.response_format);
      if (data.length === 0) {
        // A 2xx answer may already be billed even without a usable image.
        return withAcceptedJob(
          createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Pollinations returned no usable image${body.response_format ? ` in response_format ${body.response_format}` : ""}`),
          MODALITY,
          "completed-unusable",
          authScope
        );
      }
      const payload = { created: Number.isInteger(answer.created) ? answer.created : Math.floor(now() / 1000), data };
      const accounting = mediaAccounting(answer, POLLINATIONS_PROVIDER_ID, MODALITY);
      accounting.meta.authScope = authScope;
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
