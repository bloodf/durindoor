// Alibaba DashScope (Model Studio) video generation: submit, bounded poll,
// video URL. Staged for /v1/video/generations and not registered yet: the
// registration in videoProviders/index.js and the provider media tables
// follow separately. See internal/docs/port-reports/alibaba-video-1127.md.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`alibaba` -> format "dashscope-video"),
// open-sse/handlers/videoGeneration.ts (dispatch of that format) and
// open-sse/handlers/videoGeneration/dashscopeHandler.ts. The request builder
// is ../../services/alibabaVideo/request.js and the job client
// ../../services/alibabaVideo/job.js; their headers list the fork deviations.
//
// The selected connection's API key is sent as a Bearer token to a fixed
// DashScope origin only. Result URLs are returned without being downloaded;
// the public route refuses any response_format but "url" before submit
// (videoGenerationCore.js).
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { buildAlibabaVideoRequest } from "../../services/alibabaVideo/request.js";
import { ALIBABA_DASHSCOPE_INTL_ORIGIN, runAlibabaVideoJob } from "../../services/alibabaVideo/job.js";

/**
 * @param {object} [options]
 * @param {string} [options.origin] - a fixed DashScope origin; international by default
 * @param {object} [options.job] - submit and poll bounds and clock, for tests; see runAlibabaVideoJob
 */
export function createAlibabaVideoAdapter({ origin = ALIBABA_DASHSCOPE_INTL_ORIGIN, ...job } = {}) {
  return {
    async: true,
    /**
     * Generate one video for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url, format }] }`, or an error result that carries
     * `acceptedJob` when the task may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildAlibabaVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runAlibabaVideoJob({ ...job, request, credentials, signal, log, origin });
      if (!result.success) return result;
      // Usage counts the video returned. Duration and cost are unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: { ...result.accounting.meta, nativeUnitsSource: "returned-videos" },
      };
      const payload = { created: Math.floor(Date.now() / 1000), data: [{ url: result.url, format: "mp4" }] };
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

export default createAlibabaVideoAdapter();
