// RenderHour image generation: async submit + bounded poll. STAGED: not in
// IMAGE_ADAPTERS, so no route reaches it. See docs/providers/renderhour.md.
//
// Ported from cheaper-inference/OmniRoute at
// 9671192011beb2d7f83979f40be488c5da8772b9 (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza):
// open-sse/handlers/imageGeneration/providers/renderhour.ts. The job client is
// ../../services/renderhour/job.js.
//
// Fork deviations: an `rh_` API key is the only credential (no subscription
// OAuth token), only the listed image models are submitted, reference images
// are refused instead of uploaded, and result URLs are returned without being
// downloaded here.
import { randomUUID } from "node:crypto";
import { nowSec } from "./_base.js";
import { RENDERHOUR_GENERATIONS_URL, RENDERHOUR_IMAGE_MODEL_IDS } from "../../providers/private/renderhour.js";
import { awaitRenderHourImages, RENDERHOUR_MAX_IMAGES, RENDERHOUR_REQUEST_TIMEOUT_MS } from "../../services/renderhour/job.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

const MODELS = new Set(RENDERHOUR_IMAGE_MODEL_IDS);
const RATIOS = ["1:1", "3:4", "4:3", "4:5", "9:16", "16:9"];
const API_KEY_RE = /^rh_[\x21-\x7e]{1,512}$/;
const INPUT_FIELDS = ["image", "images", "image_url", "image_urls", "imageUrls", "reference_images", "mask"];

const reject = (message, status = 400) => Object.assign(new Error(message), { status });

function imageCount(n) {
  const count = isNumber(n) && Number.isFinite(n) ? Math.round(n) : 1;
  return Math.min(Math.max(count, 1), RENDERHOUR_MAX_IMAGES);
}

// `aspect_ratio` as given, else the supported ratio nearest to an OpenAI-style size.
// Unset when neither is usable, so RenderHour applies the model's default.
function aspectRatio(body) {
  const explicit = [body.aspect_ratio, body.aspectRatio].find((value) => isString(value) && value.trim());
  if (explicit) return explicit.trim();
  const match = isString(body.size) ? /^(\d+)\s*[x×:]\s*(\d+)$/i.exec(body.size.trim()) : null;
  if (!match) return undefined;
  const target = Math.log(Number(match[1]) / Number(match[2]));
  if (!Number.isFinite(target)) return undefined;
  const distance = (ratio) => {
    const [width, height] = ratio.split(":").map(Number);
    return Math.abs(Math.log(width / height) - target);
  };
  return RATIOS.toSorted((a, b) => distance(a) - distance(b))[0];
}

// OpenAI's `quality` means something else, so quality is only read inside `config`.
function modelConfig(body) {
  const given = isRecord(body.config) ? body.config : {};
  const config = {};
  if (given.resolution !== undefined) config.resolution = given.resolution;
  else if (isString(body.resolution)) config.resolution = body.resolution;
  if (isString(given.quality) || isBoolean(given.quality)) config.quality = given.quality;
  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * @param {object} [options] - submit bound and poll bounds and clock, for tests; see awaitRenderHourImages
 */
export function createRenderHourImageAdapter({ submitTimeoutMs = RENDERHOUR_REQUEST_TIMEOUT_MS, ...polling } = {}) {
  return {
    async: true,
    // Submit policy read by imageGenerationCore: a redirect is refused, never
    // followed with the key; the submit is bounded; a transport failure after
    // dispatch is a possibly billed job, so no other account resubmits it; a
    // refused submit's Retry-After reaches account cooldown.
    submitRedirect: "manual",
    submitTimeoutMs,
    submitOutcomeUnknown: true,
    retryAfterResets: true,
    buildUrl: () => RENDERHOUR_GENERATIONS_URL,
    buildHeaders: (credentials) => {
      const key = credentials?.apiKey;
      if (!isString(key) || !API_KEY_RE.test(key)) throw reject("RenderHour needs an rh_ API key", 401);
      return {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        // One key per submit: this adapter never replays a submit.
        "Idempotency-Key": randomUUID(),
      };
    },
    buildBody: (model, body) => {
      if (!MODELS.has(model)) throw reject("Unsupported RenderHour image model");
      if (!isString(body.prompt) || !body.prompt.trim()) throw reject("RenderHour needs a text prompt");
      if (INPUT_FIELDS.some((field) => body[field] != null && body[field].length !== 0)) {
        throw reject("RenderHour reference images are not supported yet");
      }
      return {
        model,
        prompt: body.prompt,
        count: imageCount(body.n),
        aspect_ratio: aspectRatio(body),
        config: modelConfig(body),
      };
    },
    parseResponse: async (response, { headers, credentials, signal, requestBody }) => ({
      urls: await awaitRenderHourImages(response, {
        ...polling,
        authorization: headers.Authorization,
        credentials,
        count: requestBody.count,
        signal,
      }),
    }),
    normalize: ({ urls }) => ({ created: nowSec(), data: urls.map((url) => ({ url })) }),
  };
}

export default createRenderHourImageAdapter();
