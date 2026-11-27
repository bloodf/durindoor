// Grok CLI native video adapter, staged for /v1/video/generations
// (VIDEO_GENERATION_ADAPTERS contract) and not registered (see
// ./registration.json). One Grok Imagine job per call through ./job.js,
// answered with the result URL. See ./config.js for the source attribution.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { GROK_CLI_PROVIDER_ID, GROK_CLI_VIDEO_MODELS } from "./config.js";
import { runGrokCliVideoJob } from "./job.js";
import { buildGrokCliVideoRequest, resolveGrokCliTiming } from "./request.js";

const RESPONSE_FORMATS = Object.freeze(["url"]);
const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

/**
 * @param {object} [options] - job bounds and clock for tests: { timeoutMs, pollIntervalMs, maxPolls,
 *   submitTimeoutMs, requestTimeoutMs, wait, now }. Explicit options win over the caller's knobs.
 */
export function createGrokCliVideoAdapter(options = {}) {
  const { now = Date.now } = options;
  return {
    async: true,
    provider: GROK_CLI_PROVIDER_ID,
    models: GROK_CLI_VIDEO_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** One video as `{ created, data: [{ url, format }] }`, or an error result (with `acceptedJob` when it may bill). */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      let timing;
      try {
        request = buildGrokCliVideoRequest(model, body);
        timing = resolveGrokCliTiming(body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runGrokCliVideoJob({ ...timing, ...options, request, credentials, signal, log });
      if (!result.success) return result;
      const payload = { created: Math.floor(now() / 1000), data: [{ url: result.url, format: "mp4" }] };
      return { success: true, accounting: result.accounting, response: jsonResponse(payload) };
    },
  };
}
