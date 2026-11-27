// Vertex AI Veo text-to-video for /v1/video/generations: submit, bounded poll,
// inline MP4. Staged and NOT registered: videoProviders/index.js, the provider
// registry and the catalog are unchanged until the serial registration change
// described in ./registration.json and
// internal/docs/port-reports/native-vertex-video.md.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`vertex` -> format "vertex-veo"),
// open-sse/handlers/videoGeneration.ts (dispatch of that format and
// handleVertexVeoGeneration) and open-sse/executors/vertexMedia.ts
// (vertexGenerateVideo). The request builder is ./request.js, the credential
// scope ./auth.js and the job client ./job.js; their headers list the fork
// deviations.
//
// The adapter follows the job-adapter contract of handlers/videoGenerationCore.js
// (`generate`, `responseFormats`, `defaultResponseFormat`, `acceptedJob` on
// errors that may bill). Vertex returns the video inline, so the only output
// format is `b64_json`; the core refuses `url` before submit.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { buildVertexVideoRequest } from "./request.js";
import { runVertexVideoJob } from "./job.js";

export const VERTEX_VIDEO_RESPONSE_FORMATS = Object.freeze(["b64_json"]);

/**
 * @param {object} [job] - submit and poll bounds, clock and token minter, for tests; see runVertexVideoJob
 */
export function createVertexVideoAdapter(job = {}) {
  return {
    async: true,
    responseFormats: VERTEX_VIDEO_RESPONSE_FORMATS,
    defaultResponseFormat: "b64_json",
    /**
     * Generate one video for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ b64_json, format: "mp4" }] }`, or an error result
     * that carries `acceptedJob` when the operation may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildVertexVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runVertexVideoJob({ ...job, model, request, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the video returned. Duration and cost are unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: { ...result.accounting.meta, nativeUnitsSource: "returned-videos" },
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

export default createVertexVideoAdapter();
