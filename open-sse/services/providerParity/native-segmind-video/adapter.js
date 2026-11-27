// Segmind video for /v1/video/generations: one synchronous POST that answers
// with the MP4 bytes. Staged and NOT registered: videoProviders/index.js, the
// provider registry and the catalog stay unchanged until the serial
// registration change described in ./registration.json and
// internal/docs/port-reports/native-segmind-video.md.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`segmind` -> format "segmind"),
// open-sse/handlers/videoGeneration.ts (dispatch of that format to
// handleSegmindVideoGeneration),
// open-sse/handlers/videoGeneration/providers/segmind.ts and
// open-sse/utils/segmindClient.ts. The body builder is ./request.js and the
// request client ./job.js; their headers list the fork deviations.
//
// The adapter follows the job-adapter contract of handlers/videoGenerationCore.js
// (`generate`, `responseFormats`, `defaultResponseFormat`, `acceptedJob` on
// errors that may bill). Segmind returns the video bytes, so the only output
// format is `b64_json` (as in the source); the core refuses `url` before submit.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { SEGMIND_VIDEO_RESPONSE_FORMATS } from "./config.js";
import { buildSegmindVideoRequest } from "./request.js";
import { runSegmindVideoJob } from "./job.js";

/**
 * @param {object} [job] - deadline, size bound and clock, for tests; see runSegmindVideoJob
 */
export function createSegmindVideoAdapter(job = {}) {
  return {
    async: true,
    responseFormats: SEGMIND_VIDEO_RESPONSE_FORMATS,
    defaultResponseFormat: "b64_json",
    /**
     * Generate one video for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ b64_json, format: "mp4" }] }`, or an error result
     * that carries `acceptedJob` when the request may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      const format = body?.response_format ?? "b64_json";
      if (!SEGMIND_VIDEO_RESPONSE_FORMATS.includes(format)) {
        return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Segmind video supports response_format b64_json only");
      }
      let request;
      try {
        request = buildSegmindVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runSegmindVideoJob({ ...job, request, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the video returned. Duration and cost are unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: { ...result.accounting.meta, nativeUnitsSource: "returned-videos", model: request.slug },
      };
      const payload = { created: Math.floor(Date.now() / 1000), data: [{ b64_json: result.base64, format: "mp4" }] };
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

export default createSegmindVideoAdapter();
