// MiniMax native video adapter, staged for /v1/video/generations
// (VIDEO_GENERATION_ADAPTERS contract) and not registered (see
// ./registration.json). One MiniMax v1 video task per call through ./job.js,
// answered with the resolved download URL. See ./config.js for the source
// attribution.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { MINIMAX_PROVIDER_ID, MINIMAX_VIDEO_MODELS } from "./config.js";
import { runMinimaxVideoTask } from "./job.js";
import { buildMinimaxVideoRequest, resolveMinimaxTiming } from "./request.js";

const RESPONSE_FORMATS = Object.freeze(["url"]);
const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

/**
 * @param {object} [options] - job bounds and clock for tests: { timeoutMs, submitTimeoutMs,
 *   requestTimeoutMs, pollIntervalMs, wait, now }. Explicit options win over the caller's
 *   `timeout_ms` / `poll_interval_ms`.
 */
export function createMinimaxVideoAdapter(options = {}) {
  const { now = Date.now } = options;
  return {
    async: true,
    provider: MINIMAX_PROVIDER_ID,
    models: MINIMAX_VIDEO_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** One video as `{ created, data: [{ url, format }] }`, or an error result (with `acceptedJob` when it may bill). */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      let timing;
      try {
        request = buildMinimaxVideoRequest(model, body);
        timing = resolveMinimaxTiming(body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runMinimaxVideoTask({ ...timing, ...options, request, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the video returned. Cost is unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: { ...result.accounting.meta, jobId: result.taskId, fileId: result.fileId, nativeUnitsSource: "returned-videos" },
      };
      const payload = { created: Math.floor(now() / 1000), data: [{ url: result.url, format: "mp4" }] };
      return { success: true, accounting, response: jsonResponse(payload) };
    },
  };
}
