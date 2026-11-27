// Leonardo native text-to-video (Motion 2.0): POST
// /api/rest/v1/generations-text-to-video, then a bounded poll of
// /generations/{id}. Staged for /v1/video/generations under the
// VIDEO_GENERATION_ADAPTERS contract and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`leonardo`, format "leonardo-video") and
// open-sse/handlers/videoGeneration/leonardoHandler.ts
// (handleLeonardoVideoGeneration: body `{ model, prompt, resolution, width,
// height, isPublic: false }`, resolveLeonardoVideoModel (catalog id -> enum,
// legacy `phoenix` -> MOTION2, anything else passed through),
// resolveLeonardoVideoSize (2:3 / 4:5 portrait shapes, else 16:9 / 9:16 with a
// short side <= 480 picking RESOLUTION_480), job `motionVideoGenerationJob`,
// result `generated_images[0].motionMP4URL` (never the jpg `url` thumbnail)).
//
// Fork deviations: the key goes only to https://cloud.leonardo.ai; the mp4 is
// returned as its public https URL and never downloaded (the source fetched it
// into `b64_json`; every fork video adapter returns URLs only); a raw model id
// must look like a Leonardo enum (upper case); a size must be `WxH` (the source
// silently fell back to 720p 16:9); duration, n > 1, streaming, image inputs
// and any other field Leonardo would not receive are refused before submit.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  LEONARDO_PORTRAIT_SIZES, LEONARDO_PROVIDER_ID, LEONARDO_VIDEO_MODEL_ENUMS, LEONARDO_VIDEO_MODELS,
  LEONARDO_VIDEO_SIZES, LEONARDO_VIDEO_SUBMIT_URL,
} from "./config.js";
import { leonardoPublicUrl } from "./http.js";
import { runLeonardoJob } from "./job.js";

const MODALITY = "video";
const RESPONSE_FORMATS = Object.freeze(["url"]);
const MAX_PROMPT_CHARS = 32_000;
const ENUM_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SIZE_RE = /^(\d{1,5})x(\d{1,5})$/i;
const ACCEPTED_FIELDS = new Set(["model", "prompt", "size", "n", "response_format", "user"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });

/** Catalog id -> Leonardo `model` enum; an upper-case enum passes through. Throws otherwise. */
export function resolveLeonardoVideoModel(model) {
  const id = isString(model) ? model.trim() : "";
  if (LEONARDO_VIDEO_MODEL_ENUMS[id]) return LEONARDO_VIDEO_MODEL_ENUMS[id];
  if (ENUM_RE.test(id)) return id;
  throw reject(`Unsupported Leonardo video model: ${id || "(none)"}. Use one of: ${LEONARDO_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
}

function portraitSize(width, height) {
  if (!(width > 0 && height > width)) return null;
  const aspect = width / height;
  return LEONARDO_PORTRAIT_SIZES.find(([w, h]) => Math.abs(aspect / (w / h) - 1) <= 0.06) ?? null;
}

/**
 * The source's size mapping. A 2:3 or 4:5 portrait size keeps its shape
 * (RESOLUTION_480 up to that shape's 480p width, else RESOLUTION_720); any
 * other size maps to 16:9 / 9:16 with a short side <= 480 picking
 * RESOLUTION_480. No size is 720p landscape. Throws on a size that is not `WxH`.
 */
export function resolveLeonardoVideoSize(size) {
  let width = 0;
  let height = 0;
  if (size !== undefined && size !== null) {
    const match = isString(size) ? SIZE_RE.exec(size.trim()) : null;
    if (!match || Number(match[1]) === 0 || Number(match[2]) === 0) throw reject("Leonardo video size must look like 1280x720");
    width = Number(match[1]);
    height = Number(match[2]);
  }
  const portrait = portraitSize(width, height);
  if (portrait) {
    const resolution = width <= portrait[0] ? "RESOLUTION_480" : "RESOLUTION_720";
    return { resolution, width: portrait[0], height: portrait[1] };
  }
  const resolution = width > 0 && Math.min(width, height) <= 480 ? "RESOLUTION_480" : "RESOLUTION_720";
  const [long, short] = LEONARDO_VIDEO_SIZES[resolution];
  return height > width ? { resolution, width: short, height: long } : { resolution, width: long, height: short };
}

/**
 * The Leonardo submit body for an OpenAI-style video request. Throws a 400
 * error for an unknown model or an input this subset cannot honor.
 */
export function buildLeonardoVideoRequest(model, body) {
  if (!isRecord(body)) throw reject("Leonardo video generation needs a JSON object");
  const modelEnum = resolveLeonardoVideoModel(model);
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Leonardo video generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`Leonardo video prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw reject("Leonardo video generation returns one video per request (n=1)");
  if (body.stream) throw reject("Leonardo video generation does not support streaming");
  if ((body.response_format ?? "url") !== "url") throw reject("Leonardo video supports response_format url only");
  const unsupported = Object.keys(body).find((field) => !ACCEPTED_FIELDS.has(field) && field !== "stream" && body[field] !== undefined && body[field] !== null);
  if (unsupported) throw reject(`Leonardo text-to-video does not support ${unsupported}`);
  return { model: modelEnum, prompt: body.prompt, ...resolveLeonardoVideoSize(body.size), isPublic: false };
}

/** The finished video: `generated_images[0].motionMP4URL`, public https only; `url` is a jpg thumbnail. */
export function leonardoVideoResult(generation) {
  const first = Array.isArray(generation.generated_images) ? generation.generated_images[0] : null;
  return isRecord(first) ? leonardoPublicUrl(first.motionMP4URL) : null;
}

/**
 * @param {object} [options] - submit/poll bounds and clock, for tests; see runLeonardoJob
 */
export function createLeonardoVideoAdapter(options = {}) {
  return {
    async: true,
    provider: LEONARDO_PROVIDER_ID,
    models: LEONARDO_VIDEO_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate one video for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url, format: "mp4" }] }`, or an error result that
     * carries `acceptedJob` when the job may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildLeonardoVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runLeonardoJob({
        ...options,
        modality: MODALITY,
        label: "video",
        submitUrl: LEONARDO_VIDEO_SUBMIT_URL,
        request,
        jobField: "motionVideoGenerationJob",
        extract: leonardoVideoResult,
        credentials,
        signal,
        log,
      });
      if (!result.success) return result;
      // Usage counts the video returned. Duration and cost are unknown here.
      const base = mediaAccounting(null, LEONARDO_PROVIDER_ID, MODALITY);
      const accounting = { ...base, nativeUnits: { videos: 1 }, meta: { ...base.meta, nativeUnitsSource: "returned-videos" } };
      const payload = { created: Math.floor(Date.now() / 1000), data: [{ url: result.result, format: "mp4" }] };
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
