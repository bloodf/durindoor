// xAI native video adapter, staged for /v1/video/generations
// (VIDEO_GENERATION_ADAPTERS contract) and not registered (see
// ./registration.json). One xAI job per call through ./job.js, answered with
// the result URL. See ./config.js for the source attribution.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { XAI_PROVIDER_ID, XAI_VIDEO_MODELS } from "./config.js";
import { runXaiVideoJob, xaiVideoSeconds } from "./job.js";
import { buildXaiVideoRequest, resolveXaiTiming } from "./request.js";

const RESPONSE_FORMATS = Object.freeze(["url"]);
const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

/**
 * @param {object} [options] - job bounds and clock for tests: { timeoutMs, submitTimeoutMs,
 *   requestTimeoutMs, pollIntervalMs, maxPolls, wait, now }. Explicit options win over the
 *   caller's `timeout_ms` / `poll_interval_ms` / `max_polls`.
 */
export function createXaiVideoAdapter(options = {}) {
  const { now = Date.now } = options;
  return {
    async: true,
    provider: XAI_PROVIDER_ID,
    models: XAI_VIDEO_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** One video as `{ created, data: [{ url, format }] }`, or an error result (with `acceptedJob` when it may bill). */
    async generate({ model, body, credentials, signal, log }) {
      let built;
      let timing;
      try {
        built = buildXaiVideoRequest(model, body);
        timing = resolveXaiTiming(body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runXaiVideoJob({ ...timing, ...options, request: built.request, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the returned video and response-measured seconds only; cost
      // is the provider receipt when xAI sends one, unknown otherwise.
      const seconds = xaiVideoSeconds(result.answer);
      const nativeUnits = { videos: 1 };
      if (seconds !== null) nativeUnits.videoSeconds = seconds;
      const accounting = {
        ...result.accounting,
        nativeUnits,
        meta: {
          ...result.accounting.meta,
          jobId: result.requestId,
          ...result.identity,
          nativeUnitsSource: seconds !== null ? "response-duration" : "returned-videos",
        },
      };
      const payload = { created: Math.floor(now() / 1000), data: [{ url: result.url, format: "mp4" }] };
      return { success: true, accounting, response: jsonResponse(payload) };
    },
  };
}
