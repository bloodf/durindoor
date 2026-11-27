// fal.ai queue video for /v1/video/generations: submit, bounded poll, result
// URL. Staged and NOT registered. videoProviders/index.js, the provider
// registry and the catalog stay unchanged until the serial registration change
// described in ./registration.json and
// internal/docs/port-reports/native-fal-ai-video.md.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`fal-ai` -> format "fal-ai-video"),
// open-sse/handlers/videoGeneration.ts (dispatch of that format to
// handleFalVideoGeneration) and open-sse/handlers/mediaGeneration/fal.ts
// (handleFalVideoGeneration: the built-in body for the source models, schema
// discovery for any other endpoint or when `fal_input` is given). The body
// builders are ./request.js and ./schema.js and the job client is ./job.js.
// Their headers list the fork deviations.
//
// The adapter follows the job-adapter contract of handlers/videoGenerationCore.js
// (`generate`, `responseFormats`, `defaultResponseFormat`, `acceptedJob` on
// errors that may bill). fal returns a hosted file, so the only output format
// is `url`. The URL is returned without being downloaded.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { buildFalVideoRequest, falDiscoveredEndpoint } from "./request.js";
import { runFalVideoJob } from "./job.js";

export const FAL_VIDEO_RESPONSE_FORMATS = Object.freeze(["url"]);

/**
 * @param {object} [job] - poll bounds, clock and an optional connection-scoped
 * definition store ({ get(connectionId, endpoint), save(connectionId, definition) }); see runFalVideoJob
 */
export function createFalVideoAdapter(job = {}) {
  return {
    async: true,
    responseFormats: FAL_VIDEO_RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate one video for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url, format? }] }`, or an error result that carries
     * `acceptedJob` when the request may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      let built;
      try {
        built = buildFalVideoRequest(model, body);
        if (!built) falDiscoveredEndpoint(model);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runFalVideoJob({
        ...job, built, model, body, credentials, signal, log, endpointFor: falDiscoveredEndpoint,
      });
      if (!result.success) return result;
      // Usage counts the video returned. Duration and cost are unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: { ...result.accounting.meta, nativeUnitsSource: "returned-videos", endpoint: result.endpoint },
      };
      const payload = { created: Math.floor(Date.now() / 1000), data: [result.video] };
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

export default createFalVideoAdapter();
