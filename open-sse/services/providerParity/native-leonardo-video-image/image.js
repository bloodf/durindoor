// Leonardo native image generation: POST /api/rest/v1/generations, then a
// bounded poll of /generations/{id}. Staged for /v1/images/generations as a
// guarded `generate` adapter and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`leonardo`, format "leonardo-image")
// and open-sse/handlers/imageGeneration/providers/leonardo.ts
// (handleLeonardoImageGeneration: body `{ modelId, prompt, width, height,
// num_images: 1 }`, resolveLeonardoModelId (catalog id -> platform-model UUID,
// anything else passed through, empty -> phoenix), resolveLeonardoImageSize
// (width/height win, then `WxH` size, then 1024), result
// `generated_images[0].url`).
//
// Fork deviations: the key goes only to https://cloud.leonardo.ai; the result
// is returned as its public https URL and never downloaded (the source fetched
// it and answered `b64_json`), so response_format is `url` only; a raw model id
// must be a platform-model UUID; sizes must be integers in 32..1536 and
// multiples of 8; n > 1, streaming, reference images / edits (the source's
// init-image flow is a separate /v1/images/edits integration, not staged here)
// and any other field Leonardo would not receive are refused before submit
// instead of silently dropped.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  LEONARDO_DEFAULT_IMAGE_MODEL, LEONARDO_IMAGE_DEFAULT_SIDE, LEONARDO_IMAGE_MAX_SIDE, LEONARDO_IMAGE_MIN_SIDE,
  LEONARDO_IMAGE_MODEL_IDS, LEONARDO_IMAGE_MODELS, LEONARDO_IMAGE_SIZES, LEONARDO_IMAGE_SUBMIT_URL,
  LEONARDO_PROVIDER_ID,
} from "./config.js";
import { leonardoPublicUrl } from "./http.js";
import { runLeonardoJob } from "./job.js";

const MODALITY = "image";
const RESPONSE_FORMATS = Object.freeze(["url"]);
const MAX_PROMPT_CHARS = 32_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIZE_RE = /^(\d{1,5})x(\d{1,5})$/i;
// OpenAI Images fields this subset maps; `user` is a gateway field and is not sent.
const ACCEPTED_FIELDS = new Set(["model", "prompt", "size", "width", "height", "n", "response_format", "user"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });

/** Catalog id -> platform-model UUID; a UUID passes through; empty -> Phoenix. Throws otherwise. */
export function resolveLeonardoImageModelId(model) {
  const id = isString(model) && model.trim() ? model.trim() : LEONARDO_DEFAULT_IMAGE_MODEL;
  if (LEONARDO_IMAGE_MODEL_IDS[id]) return LEONARDO_IMAGE_MODEL_IDS[id];
  if (UUID_RE.test(id)) return id.toLowerCase();
  throw reject(`Unsupported Leonardo image model: ${id}. Use one of: ${LEONARDO_IMAGE_MODELS.map((m) => m.id).join(", ")} or a Leonardo platform-model UUID`);
}

function side(value, field) {
  if (!isNumber(value) || !Number.isInteger(value) || value < LEONARDO_IMAGE_MIN_SIDE || value > LEONARDO_IMAGE_MAX_SIDE || value % 8 !== 0) {
    throw reject(`Leonardo image ${field} must be an integer from ${LEONARDO_IMAGE_MIN_SIDE} to ${LEONARDO_IMAGE_MAX_SIDE} and a multiple of 8`);
  }
  return value;
}

/** Explicit width/height win, then an OpenAI `WxH` size, then 1024 (source order). Throws on bad input. */
export function resolveLeonardoImageSize(body) {
  let fromSize = [undefined, undefined];
  if (body.size !== undefined && body.size !== null && body.size !== "auto") {
    const match = isString(body.size) ? SIZE_RE.exec(body.size.trim()) : null;
    if (!match) throw reject("Leonardo image size must look like 1024x1024");
    fromSize = [Number(match[1]), Number(match[2])];
  }
  const width = body.width ?? fromSize[0] ?? LEONARDO_IMAGE_DEFAULT_SIDE;
  const height = body.height ?? fromSize[1] ?? LEONARDO_IMAGE_DEFAULT_SIDE;
  return { width: side(width, "width"), height: side(height, "height") };
}

/**
 * The Leonardo submit body for an OpenAI-style image request. Throws a 400
 * error for an unknown model or an input this subset cannot honor.
 */
export function buildLeonardoImageRequest(model, body) {
  if (!isRecord(body)) throw reject("Leonardo image generation needs a JSON object");
  const modelId = resolveLeonardoImageModelId(model);
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Leonardo image generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`Leonardo image prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw reject("Leonardo image generation returns one image per request (n=1)");
  if (body.stream) throw reject("Leonardo image generation does not support streaming");
  const requested = body.response_format ?? "url";
  if (!RESPONSE_FORMATS.includes(requested)) throw reject("Leonardo image supports response_format url only");
  const unsupported = Object.keys(body).find((field) => !ACCEPTED_FIELDS.has(field) && field !== "stream" && body[field] !== undefined && body[field] !== null);
  if (unsupported) throw reject(`Leonardo image generation does not support ${unsupported}`);
  return { modelId, prompt: body.prompt, ...resolveLeonardoImageSize(body), num_images: 1 };
}

/** The finished image: `generated_images[0].url`, public https only. */
export function leonardoImageResult(generation) {
  const first = Array.isArray(generation.generated_images) ? generation.generated_images[0] : null;
  return isRecord(first) ? leonardoPublicUrl(first.url) : null;
}

/**
 * @param {object} [options] - submit/poll bounds and clock, for tests; see runLeonardoJob
 */
export function createLeonardoImageAdapter(options = {}) {
  return {
    provider: LEONARDO_PROVIDER_ID,
    models: LEONARDO_IMAGE_MODELS,
    supportedSizes: LEONARDO_IMAGE_SIZES,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate one image for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url }] }`, or an error result that carries
     * `acceptedJob` when Leonardo may have run (and billed) the generation
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildLeonardoImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runLeonardoJob({
        ...options,
        modality: MODALITY,
        label: "image",
        submitUrl: LEONARDO_IMAGE_SUBMIT_URL,
        request,
        jobField: "sdGenerationJob",
        extract: leonardoImageResult,
        credentials,
        signal,
        log,
      });
      if (!result.success) return result;
      const payload = { created: Math.floor(Date.now() / 1000), data: [{ url: result.result }] };
      // Usage counts the image returned. Leonardo API credits are not converted to a cost.
      const accounting = mediaAccounting(null, LEONARDO_PROVIDER_ID, MODALITY);
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
