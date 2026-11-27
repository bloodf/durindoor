// Novita native video adapter, staged for /v1/video/generations
// (VIDEO_GENERATION_ADAPTERS contract) and not registered (see
// ./registration.json). One Novita async task per call through ./job.js,
// answered with the result URL. See ./config.js for the source attribution.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { NOVITA_PROVIDER_ID, NOVITA_VIDEO_MODELS, novitaSubmitUrl, novitaVideoModel } from "./config.js";
import { runNovitaVideoTask } from "./job.js";
import { buildNovitaVideoRequest, resolveNovitaTiming } from "./request.js";

const RESPONSE_FORMATS = Object.freeze(["url"]);
const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

/**
 * @param {object} [options] - job bounds and clock for tests: { timeoutMs, submitTimeoutMs,
 *   requestTimeoutMs, pollIntervalMs, wait, now }. Explicit options win over the caller's
 *   `timeout_ms` / `poll_interval_ms`.
 */
export function createNovitaVideoAdapter(options = {}) {
  const { now = Date.now } = options;
  return {
    async: true,
    provider: NOVITA_PROVIDER_ID,
    models: NOVITA_VIDEO_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** One video as `{ created, data: [{ url, format }] }`, or an error result (with `acceptedJob` when it may bill). */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      let timing;
      try {
        request = buildNovitaVideoRequest(model, body);
        timing = resolveNovitaTiming(body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runNovitaVideoTask({
        ...timing,
        ...options,
        submitUrl: novitaSubmitUrl(novitaVideoModel(model)),
        request,
        credentials,
        signal,
        log,
      });
      if (!result.success) return result;
      // Usage counts the video returned. Cost is unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: { ...result.accounting.meta, jobId: result.taskId, nativeUnitsSource: "returned-videos" },
      };
      const payload = { created: Math.floor(now() / 1000), data: [{ url: result.url, format: "mp4" }] };
      return { success: true, accounting, response: jsonResponse(payload) };
    },
  };
}
