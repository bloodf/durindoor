// Adobe Firefly Services API text-to-video: submit, bounded poll, video URL.
// STAGED: videoCore.js does not import this, so no route reaches it. See
// docs/providers/adobe-firefly-api.md.
//
// Written from Adobe's published contract, AdobeDocs/ffs-firefly-api at
// 1027f559cdb1509a61b34e2f2da9618ec431f2cb: static/firefly-api.json
// (GenerateVideoRequestV3, VideoSettingsV3, CameraMotion, VideoPromptStyle,
// ShotAngle, ShotSize, ClinetoSize and the `x-model-version` enum of
// POST /v3/videos/generate) and src/pages/getting-started/usage-notes/index.md
// ("Generate Video API usage": supported aspect ratios and dimensions). No
// third-party code was ported. The job client is
// ../../services/adobeFireflyApi/video.js.
//
// This slice is text-to-video only. Keyframe images (`image.conditions`) need
// a pre-signed URL on an Adobe-allowed storage domain or an upload through
// /v2/storage/image, so they are refused instead of forwarded. Result URLs are
// returned without being downloaded, even for `response_format: "b64_json"`.
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import {
  ADOBE_FIREFLY_API_MODEL_IDS,
  ADOBE_FIREFLY_VIDEO_MODEL_IDS,
  ADOBE_FIREFLY_VIDEO_SECONDS,
  ADOBE_FIREFLY_VIDEO_SIZES,
} from "../../providers/private/adobe-firefly-api.js";
import { defaultAdobeTokenCache } from "../../services/adobeFireflyApi/auth.js";
import { ADOBE_FIREFLY_VIDEO_SUBMIT_TIMEOUT_MS, runAdobeFireflyVideoJob } from "../../services/adobeFireflyApi/video.js";
import { isNumber, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

const VIDEO_MODELS = new Set(ADOBE_FIREFLY_VIDEO_MODEL_IDS);
const IMAGE_MODELS = new Set(ADOBE_FIREFLY_API_MODEL_IDS);
// A gateway bound: Adobe documents no prompt length for video.
export const ADOBE_FIREFLY_VIDEO_MAX_PROMPT_LENGTH = 4096;

// VideoSettingsV3 enums, verbatim.
const SETTINGS = {
  cameraMotion: ["camera pan left", "camera pan right", "camera zoom in", "camera zoom out", "camera tilt up", "camera tilt down", "camera locked down", "camera handheld"],
  promptStyle: ["anime", "3d", "fantasy", "cinematic", "claymation", "line art", "stop motion", "2d", "vector art", "black and white"],
  shotAngle: ["aerial shot", "eye_level shot", "high angle shot", "low angle shot", "top-down shot"],
  shotSize: ["close-up shot", "extreme close-up", "medium shot", "long shot", "extreme long shot"],
};
const SNAKE = { cameraMotion: "camera_motion", promptStyle: "prompt_style", shotAngle: "shot_angle", shotSize: "shot_size" };
const RATIOS = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1] };
const CHAT_FIELDS = ["messages", "input_messages", "tools", "tool_choice"];
const IMAGE_INPUT_FIELDS = [
  "image", "images", "image_url", "imageUrl", "image_urls", "imageUrls", "start_image", "first_frame", "end_image",
  "last_frame", "lastFrame", "end_image_url", "prompt_image", "promptImage", "reference_images", "references",
  "input_reference", "conditions", "video", "video_url",
];

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value != null && value !== "" && !(Array.isArray(value) && value.length === 0);
const sizeLabel = ([width, height]) => `${width}x${height}`;

function assertModel(model) {
  if (VIDEO_MODELS.has(model)) return;
  if (IMAGE_MODELS.has(model)) throw reject(`${model} is an Adobe Firefly image model, not a video model`);
  throw reject("Unsupported Adobe Firefly Services video model");
}

// Every Firefly video is five seconds; any other duration is refused.
function assertSeconds(body) {
  for (const field of ["seconds", "duration", "duration_s"]) {
    const value = body[field];
    if (value == null) continue;
    const numeric = isNumber(value) ? value : isString(value) ? Number(value.trim().replace(/s$/i, "")) : NaN;
    if (numeric !== ADOBE_FIREFLY_VIDEO_SECONDS) {
      throw reject(`Adobe Firefly videos are ${ADOBE_FIREFLY_VIDEO_SECONDS} seconds; ${field} must be ${ADOBE_FIREFLY_VIDEO_SECONDS}`);
    }
  }
}

// One documented size from `size` ("WxH"), or `aspect_ratio` with a
// `resolution` ("1080p", "720p", "540p": the short side). Unset otherwise.
function videoSize(body) {
  const allowed = `one of: ${ADOBE_FIREFLY_VIDEO_SIZES.map(sizeLabel).join(", ")}`;
  if (present(body.size)) {
    const match = isString(body.size) ? /^(\d{1,4})\s*[x×]\s*(\d{1,4})$/i.exec(body.size.trim()) : null;
    const found = match && ADOBE_FIREFLY_VIDEO_SIZES.find(([w, h]) => w === Number(match[1]) && h === Number(match[2]));
    if (!found) throw reject(`Adobe Firefly video size must be ${allowed}`);
    return { width: found[0], height: found[1] };
  }
  const ratio = [body.aspect_ratio, body.aspectRatio].find(present);
  const resolution = body.resolution;
  if (ratio == null && resolution == null) return undefined;
  if (!isString(ratio) || !RATIOS[ratio.trim()]) throw reject("Adobe Firefly video aspect_ratio must be one of: 16:9, 9:16, 1:1");
  const short = isString(resolution) ? /^(\d{3,4})p$/i.exec(resolution.trim()) : null;
  const [rw, rh] = RATIOS[ratio.trim()];
  const found = short && ADOBE_FIREFLY_VIDEO_SIZES.find(([w, h]) => Math.min(w, h) === Number(short[1]) && w * rh === h * rw);
  if (!found) throw reject(`Adobe Firefly video needs a size of ${allowed}`);
  return { width: found[0], height: found[1] };
}

function seeds(body) {
  const given = body.seeds ?? (body.seed == null ? undefined : [body.seed]);
  if (given === undefined) return undefined;
  if (!Array.isArray(given) || given.length !== 1 || !Number.isSafeInteger(given[0])) {
    throw reject("Adobe Firefly video takes exactly one integer seed");
  }
  return [given[0]];
}

function bitRateFactor(body) {
  const value = body.bitRateFactor ?? body.bit_rate_factor;
  if (value == null) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 63) throw reject("Adobe Firefly bitRateFactor must be an integer from 0 to 63");
  return value;
}

function videoSettings(body) {
  const given = isRecord(body.videoSettings) ? body.videoSettings : isRecord(body.video_settings) ? body.video_settings : {};
  const settings = {};
  for (const [key, values] of Object.entries(SETTINGS)) {
    const value = given[key] ?? given[SNAKE[key]] ?? body[key] ?? body[SNAKE[key]];
    if (value == null) continue;
    if (!values.includes(value)) throw reject(`Adobe Firefly ${key} must be one of: ${values.join(", ")}`);
    settings[key] = value;
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

/**
 * The GenerateVideoRequestV3 body for an OpenAI-style video request. Throws a
 * 400 error for a non-video model, a chat body, image input or an unusable field.
 */
export function buildAdobeFireflyVideoRequest(model, body) {
  if (!isRecord(body)) throw reject("Adobe Firefly video generation needs a JSON object");
  if (CHAT_FIELDS.some((field) => body[field] !== undefined)) throw reject("Adobe Firefly Services has no chat; send a video request");
  assertModel(model);
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Adobe Firefly video generation needs a text prompt");
  if (body.prompt.length > ADOBE_FIREFLY_VIDEO_MAX_PROMPT_LENGTH) {
    throw reject(`Adobe Firefly video prompts are limited to ${ADOBE_FIREFLY_VIDEO_MAX_PROMPT_LENGTH} characters here`);
  }
  if (IMAGE_INPUT_FIELDS.some((field) => present(body[field]))) {
    throw reject("Adobe Firefly image-to-video keyframes are not supported yet");
  }
  if (body.n != null && body.n !== 1) throw reject("Adobe Firefly generates one video per request");
  assertSeconds(body);
  const size = videoSize(body);
  const request = {
    prompt: body.prompt,
    sizes: size ? [size] : undefined,
    seeds: seeds(body),
    bitRateFactor: bitRateFactor(body),
    videoSettings: videoSettings(body),
  };
  for (const key of Object.keys(request)) if (request[key] === undefined) delete request[key];
  return request;
}

/**
 * @param {object} [options]
 * @param {object} [options.cache] - IMS token cache; one per process by default, shared with images
 * @param {number} [options.submitTimeoutMs] - submit bound, for tests
 * @param {object} [options.polling] - poll bounds and clock, for tests; see awaitAdobeFireflyVideo
 */
export function createAdobeFireflyApiVideoAdapter({
  cache = defaultAdobeTokenCache,
  submitTimeoutMs = ADOBE_FIREFLY_VIDEO_SUBMIT_TIMEOUT_MS,
  ...polling
} = {}) {
  return {
    async: true,
    /**
     * Generate one video for the selected connection, synchronously: the call
     * returns once the job has a result, failed, or was abandoned.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url }] }`, or an error result that carries
     * `acceptedJob` when the job may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildAdobeFireflyVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runAdobeFireflyVideoJob({ model, request, credentials, signal, log, cache, submitTimeoutMs, polling });
      if (!result.success) return result;
      // Usage counts the video returned. Cost is unknown: Adobe reports none.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: { ...result.accounting.meta, nativeUnitsSource: "returned-videos" },
      };
      const payload = { created: Math.floor(Date.now() / 1000), data: [{ url: result.url }] };
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

export default createAdobeFireflyApiVideoAdapter();
