// Fireworks AI native image generation: one synchronous POST to
// https://api.fireworks.ai/inference/v1/images/generations. Staged for
// /v1/images/generations as a guarded `generate` adapter and not registered
// (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`fireworks`, format "openai") and
// open-sse/handlers/imageGeneration.ts handleOpenAIImageGeneration: body
// `{ model, prompt, ...output options, n, size, quality, response_format, style }`
// with each optional field forwarded only when given, output options validated
// by handlers/imageGeneration/generationOptions.ts (non-openai providers get
// only the output_format / frame controls), `Authorization: Bearer <key>`,
// and an OpenAI `data[]` answer whose items need a `url` or `b64_json` (an
// empty 2xx is a 502) via handlers/imageGeneration/openAiImageFetch.ts. The
// source never forwards reference images for these model ids
// (OPENAI_IMAGE_TO_IMAGE_MODELS holds bare `flux-kontext-*` ids only).
//
// Fork deviations: the key goes only to the fixed Fireworks origin; the call
// is time bounded, aborts on the caller's signal and refuses redirects; the
// answer is size bounded and never quoted in an error; the model must be one
// of the five catalog ids and `size` one of the registry's supportedSizes;
// `n` must be an integer 1..10; reference images, masks, streaming and
// binary output are refused instead of dropped; a requested response_format
// must be the one returned (a URL is never downloaded and base64 is never
// re-hosted); result URLs must be public https; a send whose outcome is
// unknown carries `acceptedJob` and is never resent.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { MAX_IMAGE_BYTES } from "../../../config/mediaConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { prepareImageOutputOptions } from "../../../handlers/imageProviders/outputFormat.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  FIREWORKS_IMAGE_MAX_N, FIREWORKS_IMAGE_MODELS, FIREWORKS_IMAGE_SIZES, FIREWORKS_IMAGE_TIMEOUT_MS,
  FIREWORKS_IMAGE_URL, FIREWORKS_PROVIDER_ID, FIREWORKS_RESPONSE_FORMATS, fireworksImageModel,
} from "./config.js";
import {
  boundedFetch, fireworksHeaders, fireworksPublicUrl, fireworksSecrets, fireworksToken, provenUnsent,
  readJsonObject, redirectState, refusedAnswer, withAcceptedJob,
} from "./http.js";

const MODALITY = "image";
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_PROMPT_CHARS = 32_000;
const MAX_STRING_OPTION = 64;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
// Reference-image and edit fields: the source never forwarded them for these
// models, so accepting them would silently generate from the prompt alone.
const IMAGE_INPUT_FIELDS = ["image", "image_url", "imageUrls", "image_urls", "images", "mask", "mask_url", "input_image"];

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "Fireworks image request aborted");
const decodedBytes = (b64) => Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
const present = (value) => value !== undefined && value !== null;

function hasChatImagePart(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => Array.isArray(message?.content) && message.content.some((part) => part?.type === "image_url"));
}

function shortOption(body, field) {
  if (!present(body[field])) return undefined;
  if (!isString(body[field]) || !body[field].trim() || body[field].length > MAX_STRING_OPTION) throw reject(`${field} must be a short string`);
  return body[field];
}

/**
 * The Fireworks body for an OpenAI-style image request. Throws a 400 error for
 * an unknown model or an input this subset cannot honor.
 */
export function buildFireworksImageRequest(model, body) {
  if (!fireworksImageModel(model)) {
    throw reject(`Unsupported Fireworks image model: ${model}. Use one of: ${FIREWORKS_IMAGE_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("Fireworks image generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Fireworks image generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`Fireworks image prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.stream) throw reject("Fireworks image generation does not support streaming");
  const input = IMAGE_INPUT_FIELDS.find((field) => present(body[field]));
  if (input || hasChatImagePart(body.messages)) {
    throw reject(`Fireworks image generation is text-to-image only here; ${input ?? "image_url parts"} is not supported`);
  }
  if (present(body.n) && !(Number.isInteger(body.n) && body.n >= 1 && body.n <= FIREWORKS_IMAGE_MAX_N)) {
    throw reject(`n must be an integer from 1 to ${FIREWORKS_IMAGE_MAX_N}`);
  }
  if (present(body.size) && !FIREWORKS_IMAGE_SIZES.includes(body.size)) {
    throw reject(`Fireworks image size must be one of: ${FIREWORKS_IMAGE_SIZES.join(", ")}`);
  }
  if (present(body.response_format) && !FIREWORKS_RESPONSE_FORMATS.includes(body.response_format)) {
    throw reject(`Fireworks image supports response_format ${FIREWORKS_RESPONSE_FORMATS.join(", ")} only`);
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
    } else if (isString(item.url) && fireworksPublicUrl(item.url)) {
      out.url = fireworksPublicUrl(item.url);
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
export function createFireworksImageAdapter({ timeoutMs = FIREWORKS_IMAGE_TIMEOUT_MS, now = Date.now } = {}) {
  return {
    provider: FIREWORKS_PROVIDER_ID,
    format: "openai",
    models: FIREWORKS_IMAGE_MODELS,
    supportedSizes: FIREWORKS_IMAGE_SIZES,
    responseFormats: FIREWORKS_RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate images for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url } | { b64_json }] }`, or an error result that
     * carries `acceptedJob` when Fireworks may have run (and billed) the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildFireworksImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = fireworksToken(credentials);
      if (!token) return createErrorResult(401, "Fireworks API key is required");
      if (signal?.aborted) return abortedResult();
      const secrets = fireworksSecrets(credentials);
      const deadline = now() + timeoutMs;
      const remaining = () => Math.max(1, deadline - now());

      let response;
      try {
        response = await boundedFetch(FIREWORKS_IMAGE_URL, {
          method: "POST",
          headers: fireworksHeaders(token),
          body: JSON.stringify(request),
          redirect: "manual",
          proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: remaining() });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), MODALITY, "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Fireworks image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `Fireworks image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`
        ), MODALITY, "submit-unknown");
      }

      const redirect = redirectState(response);
      if (redirect?.refused) {
        log?.debug?.("FIREWORKS_IMAGE", "image request redirect refused");
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Fireworks image request redirect refused");
      }
      if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Fireworks image request was redirected"), MODALITY, "submit-unknown");
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
          createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Fireworks returned no usable image${body.response_format ? ` in response_format ${body.response_format}` : ""}`),
          MODALITY,
          "completed-unusable"
        );
      }
      const payload = { created: Number.isInteger(answer.created) ? answer.created : Math.floor(now() / 1000), data };
      const accounting = mediaAccounting(answer, FIREWORKS_PROVIDER_ID, MODALITY);
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
