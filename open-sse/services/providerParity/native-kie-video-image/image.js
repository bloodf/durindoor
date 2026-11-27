// KIE native image generation: a createTask on one of three source routes and
// a bounded record-info poll. Staged for /v1/images/generations as a guarded
// `generate` adapter and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`kie`, format "kie-image",
// supportedSizes) and open-sse/handlers/imageGeneration.ts
// (handleKieImageGeneration and normalizeKieImageResult):
//   - Flux Kontext (catalog kieFluxKontextModel): POST
//     /api/v1/flux/kontext/generate `{ prompt, aspectRatio, model, inputImage? }`,
//     poll /api/v1/flux/kontext/record-info;
//   - Market (isMarket or a namespaced id): POST /api/v1/jobs/createTask
//     `{ model: upstreamId, input: { prompt, aspect_ratio, image_url? } }`,
//     poll /api/v1/jobs/recordInfo;
//   - direct (gpt4o-image): POST /api/v1/gpt4o-image/generate
//     `{ prompt, size, nVariants: n || 1 }`, poll /api/v1/gpt4o-image/record-info;
//   - the ratio is mapImageSize(size) (OpenAI pixel sizes mapped, ratios passed,
//     default 1:1); the input image is the first of extractImageInputs;
//   - result URLs from resultJson.{resultUrls,imageUrls,resultUrl,imageUrl},
//     data.response.{resultUrls,resultUrl,resultImageUrl,resultImageUrls} and
//     data.{resultImageUrls,resultImageUrl,url}, de-duplicated.
//
// Fork deviations (beyond ./job.js): the ratio must be one of the registry's
// supportedSizes; aspect_ratio, a second input image, an input image on the
// direct route, n other than 1 (or 1/2/4 on the direct route), masks, OpenAI
// quality/style/output options, streaming and b64_json output are refused
// instead of dropped; input images must be public https URLs (KIE fetches
// them, the gateway never does); result URLs must be public https and are
// returned without being downloaded; items carry no `revised_prompt` (the
// source echoed the request prompt there); caller `timeout_ms` /
// `poll_interval_ms` are not honored (fixed bounds).
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  KIE_IMAGE_MODELS, KIE_IMAGE_SIZES, KIE_OPENAI_SIZE_TO_RATIO, KIE_PROVIDER_ID, kieImageModel, kieImageRoute,
  kieMarketUpstreamId,
} from "./config.js";
import { kieResultJson, runKieTask } from "./job.js";
import { kiePublicUrl } from "./http.js";

const MODALITY = "image";
const MAX_PROMPT_CHARS = 32_000;
const DIRECT_VARIANTS = Object.freeze([1, 2, 4]);
// OpenAI Images fields KIE does not take here; the source dropped them silently.
const REFUSED_FIELDS = ["aspect_ratio", "mask", "mask_url", "quality", "style", "output_format", "output_compression", "background", "moderation"];

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });

/** The source's mapImageSize, limited to the registry's supportedSizes. */
function ratioOf(size) {
  if (size === undefined || size === null || size === "") return "1:1";
  if (!isString(size)) throw reject("size must be a string");
  const ratio = KIE_IMAGE_SIZES.includes(size) ? size : KIE_OPENAI_SIZE_TO_RATIO[size];
  if (!ratio || !KIE_IMAGE_SIZES.includes(ratio)) {
    throw reject(`KIE image size must be one of: ${KIE_IMAGE_SIZES.join(", ")} (or 256x256, 512x512, 1024x1024, 1792x1024, 1024x1792)`);
  }
  return ratio;
}

/** extractImageInputs: image_url, image, imageUrls, image_urls, chat image parts; de-duplicated. */
function imageInputs(body) {
  const seen = new Set();
  const push = (candidate, field) => {
    if (candidate === undefined || candidate === null) return;
    if (!isString(candidate)) throw reject(`${field} must be a string image URL`);
    const trimmed = candidate.trim();
    if (trimmed) seen.add(trimmed);
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
  const inputs = [...seen];
  if (inputs.length > 1) throw reject("KIE image generation takes one input image here");
  for (const input of inputs) if (!kiePublicUrl(input)) throw reject("KIE input images must be public https URLs");
  return inputs;
}

/**
 * The KIE request for an OpenAI-style image request: `{ route, request }`.
 * Throws a 400 error for an unknown model or an input this subset cannot honor.
 */
export function buildKieImageRequest(model, body) {
  const entry = kieImageModel(model);
  if (!entry) throw reject(`Unsupported KIE image model: ${model}. Use one of: ${KIE_IMAGE_MODELS.map((m) => m.id).join(", ")}`);
  if (!isRecord(body)) throw reject("KIE image generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("KIE image generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`KIE image prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.stream) throw reject("KIE image generation does not support streaming");
  const refused = REFUSED_FIELDS.find((field) => body[field] !== undefined && body[field] !== null);
  if (refused) throw reject(`KIE image generation does not support ${refused}${refused === "aspect_ratio" ? "; pass the ratio as size" : ""}`);
  if (body.response_format !== undefined && body.response_format !== null && body.response_format !== "url") {
    throw reject("KIE image supports response_format url only");
  }
  const route = kieImageRoute(entry);
  const n = body.n ?? 1;
  if (route.id === "direct" ? !DIRECT_VARIANTS.includes(n) : n !== 1) {
    throw reject(route.id === "direct" ? "KIE 4o Image takes n of 1, 2 or 4" : "KIE image generation returns one image per request (n=1)");
  }
  const ratio = ratioOf(body.size);
  const [input] = imageInputs(body);
  const prompt = body.prompt;

  if (route.id === "fluxKontext") {
    return { route, request: { prompt, aspectRatio: ratio, model: entry.kieFluxKontextModel, ...(input ? { inputImage: input } : {}) } };
  }
  if (route.id === "market") {
    return { route, request: { model: kieMarketUpstreamId(model), input: { prompt, aspect_ratio: ratio, ...(input ? { image_url: input } : {}) } } };
  }
  if (input) throw reject("KIE 4o Image does not take an input image here");
  return { route, request: { prompt, size: ratio, nVariants: n } };
}

/** The source's normalizeKieImageResult candidate fields, in its order. */
export function kieImageResultCandidates(record) {
  const resultJson = kieResultJson(record);
  const data = isRecord(record?.data) ? record.data : {};
  const response = isRecord(data.response) ? data.response : {};
  return [
    resultJson.resultUrls, resultJson.imageUrls, resultJson.resultUrl, resultJson.imageUrl,
    response.resultUrls, response.resultUrl, response.resultImageUrl, response.resultImageUrls,
    data.resultImageUrls, data.resultImageUrl, data.url,
  ];
}

/**
 * @param {object} [options] - task bounds and clock, for tests; see runKieTask
 */
export function createKieImageAdapter(options = {}) {
  return {
    async: true,
    provider: KIE_PROVIDER_ID,
    models: KIE_IMAGE_MODELS,
    supportedSizes: KIE_IMAGE_SIZES,
    responseFormats: Object.freeze(["url"]),
    defaultResponseFormat: "url",
    /**
     * Generate images for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url }] }`, or an error result that carries
     * `acceptedJob` when KIE may have run (and billed) the task
     */
    async generate({ model, body, credentials, signal, log }) {
      let built;
      try {
        built = buildKieImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runKieTask({
        ...options,
        modality: MODALITY,
        createUrl: built.route.createUrl,
        statusUrl: built.route.statusUrl,
        request: built.request,
        extractUrls: kieImageResultCandidates,
        credentials,
        signal,
        log,
      });
      if (!result.success) return result;
      const payload = { created: Math.floor(Date.now() / 1000), data: result.urls.map((url) => ({ url })) };
      const { accounting } = result;
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
