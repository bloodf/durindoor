// Haiper native image and video adapters. Staged for /v1/images/generations
// (guarded `generate` adapter) and /v1/video/generations
// (VIDEO_GENERATION_ADAPTERS contract) and not registered (see
// ./registration.json). Both run one Haiper job through ./job.js and answer
// with the result URL; the source downloaded it and answered base64, which
// this fork does not do (no result fetch, so no SSRF-exposed download).
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import {
  HAIPER_IMAGE_ASPECT_RATIOS, HAIPER_IMAGE_MODELS, HAIPER_IMAGE_SUBMIT_URL, HAIPER_PROVIDER_ID, HAIPER_VIDEO_MODELS,
  HAIPER_VIDEO_SUBMIT_URL,
} from "./config.js";
import { runHaiperJob } from "./job.js";
import { buildHaiperImageRequest, buildHaiperVideoRequest } from "./request.js";

const RESPONSE_FORMATS = Object.freeze(["url"]);
const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

function build(builder, model, body) {
  try {
    return { request: builder(model, body) };
  } catch (error) {
    return { error: createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message) };
  }
}

/**
 * @param {object} [options] - job bounds and clock for tests: { timeoutMs, submitTimeoutMs,
 *   requestTimeoutMs, pollIntervalMs, wait, now }
 */
export function createHaiperImageAdapter(options = {}) {
  return {
    async: true,
    provider: HAIPER_PROVIDER_ID,
    models: HAIPER_IMAGE_MODELS,
    supportedSizes: HAIPER_IMAGE_ASPECT_RATIOS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** One image as `{ created, data: [{ url }] }`, or an error result (with `acceptedJob` when it may bill). */
    async generate({ model, body, credentials, signal, log }) {
      const { request, error } = build(buildHaiperImageRequest, model, body);
      if (error) return error;
      const result = await runHaiperJob({ ...options, modality: "image", submitUrl: HAIPER_IMAGE_SUBMIT_URL, request, credentials, signal, log });
      if (!result.success) return result;
      const payload = { created: Math.floor(Date.now() / 1000), data: [{ url: result.url }] };
      const accounting = { ...result.accounting, meta: { ...result.accounting.meta, jobId: result.jobId } };
      returnedImageUnits(accounting, payload);
      return { success: true, accounting, response: jsonResponse(payload) };
    },
  };
}

/** See createHaiperImageAdapter for options. */
export function createHaiperVideoAdapter(options = {}) {
  return {
    async: true,
    provider: HAIPER_PROVIDER_ID,
    models: HAIPER_VIDEO_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** One video as `{ created, data: [{ url, format }] }`, or an error result (with `acceptedJob` when it may bill). */
    async generate({ model, body, credentials, signal, log }) {
      const { request, error } = build(buildHaiperVideoRequest, model, body);
      if (error) return error;
      const result = await runHaiperJob({ ...options, modality: "video", submitUrl: HAIPER_VIDEO_SUBMIT_URL, request, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the video returned. Cost is unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: { ...result.accounting.meta, jobId: result.jobId, nativeUnitsSource: "returned-videos" },
      };
      const payload = { created: Math.floor(Date.now() / 1000), data: [{ url: result.url, format: "mp4" }] };
      return { success: true, accounting, response: jsonResponse(payload) };
    },
  };
}
