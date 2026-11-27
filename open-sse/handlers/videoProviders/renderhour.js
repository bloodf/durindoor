// RenderHour text-to-video: submit, bounded poll, file URLs. STAGED: videoCore.js
// does not import this, so no route reaches it. See docs/providers/renderhour.md.
//
// Ported from cheaper-inference/OmniRoute at
// 9671192011beb2d7f83979f40be488c5da8772b9 (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza):
// open-sse/handlers/videoGeneration/renderhourHandler.ts and the request helpers
// of open-sse/handlers/mediaGeneration/renderhour.ts. The job client is
// ../../services/renderhour/media.js.
//
// Fork deviations: an `rh_` API key only; start frames, end frames and
// reference images are refused instead of uploaded; an explicit aspect ratio or
// duration that RenderHour cannot take is refused instead of passed on or
// dropped; result URLs are returned without being downloaded, even for
// `response_format: "b64_json"`; and the poll bounds are fixed.
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { assertRenderHourTask, runRenderHourMediaJob } from "../../services/renderhour/media.js";
import { RENDERHOUR_MAX_MEDIA_OUTPUTS, RENDERHOUR_REQUEST_TIMEOUT_MS } from "../../services/renderhour/job.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

/** Aspect ratios every RenderHour video model takes (the source's RENDERHOUR_VIDEO_RATIOS). */
export const RENDERHOUR_VIDEO_RATIOS = Object.freeze(["16:9", "9:16", "1:1"]);
const CONFIG_KEYS = ["resolution", "quality", "mode", "audio", "duration_s"];
// The source uploads these as frames and references; this slice does not.
const IMAGE_INPUT_FIELDS = [
  "start_image", "first_frame", "image", "image_url", "imageUrl", "prompt_image", "promptImage",
  "end_image", "last_frame", "end_image_url", "lastFrame",
  "reference_images", "references", "image_urls", "imageUrls", "input_reference",
];
const FORMAT = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value != null && value !== "" && !(Array.isArray(value) && value.length === 0);

// Whole seconds from `duration_s`, `duration` or OpenAI's `seconds` (8, "8" or "8s").
function seconds(body) {
  for (const field of ["duration_s", "duration", "seconds"]) {
    const value = body[field];
    if (value == null) continue;
    const numeric = isNumber(value) ? value : isString(value) ? Number(value.trim().replace(/s$/i, "")) : NaN;
    if (!Number.isFinite(numeric) || numeric <= 0) throw reject(`${field} must be a positive number of seconds`);
    return Math.round(numeric);
  }
  return undefined;
}

// `aspect_ratio` when it is one RenderHour takes, else the ratio nearest an OpenAI `size`.
function aspectRatio(body) {
  const explicit = [body.aspect_ratio, body.aspectRatio, body.ratio].find((value) => isString(value) && value.trim());
  if (explicit) {
    if (!RENDERHOUR_VIDEO_RATIOS.includes(explicit.trim())) {
      throw reject(`aspect_ratio must be one of: ${RENDERHOUR_VIDEO_RATIOS.join(", ")}`);
    }
    return explicit.trim();
  }
  const match = isString(body.size) ? /^(\d+)\s*[x×:]\s*(\d+)$/i.exec(body.size.trim()) : null;
  if (!match) return undefined;
  const target = Math.log(Number(match[1]) / Number(match[2]));
  if (!Number.isFinite(target)) return undefined;
  const distance = (ratio) => {
    const [width, height] = ratio.split(":").map(Number);
    return Math.abs(Math.log(width / height) - target);
  };
  return RENDERHOUR_VIDEO_RATIOS.toSorted((a, b) => distance(a) - distance(b))[0];
}

// `config` as given (known keys only), plus the top-level resolution, mode and audio shortcuts.
function modelConfig(body) {
  const given = isRecord(body.config) ? body.config : {};
  const config = {};
  for (const key of CONFIG_KEYS) if (given[key] !== undefined) config[key] = given[key];
  if (config.resolution === undefined && isString(body.resolution)) config.resolution = body.resolution;
  if (config.mode === undefined && isString(body.mode)) config.mode = body.mode;
  if (config.audio === undefined && isBoolean(body.audio)) config.audio = body.audio;
  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * The RenderHour submit body for an OpenAI-style video request. Throws a 400
 * error for a non-video model, a chat body, image input or an unusable field.
 */
export function buildRenderHourVideoRequest(model, body) {
  if (!isRecord(body)) throw reject("RenderHour video generation needs a JSON object");
  assertRenderHourTask("video", model, body);
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("RenderHour video generation needs a text prompt");
  if (IMAGE_INPUT_FIELDS.some((field) => present(body[field]))) {
    throw reject("RenderHour image-to-video and reference images are not supported yet");
  }
  const request = { model, prompt: body.prompt, duration_s: seconds(body), aspect_ratio: aspectRatio(body), config: modelConfig(body) };
  for (const key of Object.keys(request)) if (request[key] === undefined) delete request[key];
  return request;
}

/**
 * @param {object} [options] - submit bound and poll bounds and clock, for tests; see awaitRenderHourJob
 */
export function createRenderHourVideoAdapter({ submitTimeoutMs = RENDERHOUR_REQUEST_TIMEOUT_MS, ...polling } = {}) {
  return {
    async: true,
    /**
     * Generate one video for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url, format }] }`, or an error result that carries
     * `acceptedJob` when the job may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildRenderHourVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runRenderHourMediaJob({
        task: "video", request, credentials, signal, log, count: RENDERHOUR_MAX_MEDIA_OUTPUTS, submitTimeoutMs, polling,
      });
      if (!result.success) return result;
      const data = result.files.map((file) => ({ url: file.url, format: FORMAT[file.contentType] }));
      // Usage counts the videos returned. Duration and cost are unknown.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: data.length },
        meta: { ...result.accounting.meta, nativeUnitsSource: "returned-videos" },
      };
      const payload = { created: Math.floor(Date.now() / 1000), data };
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

export default createRenderHourVideoAdapter();
