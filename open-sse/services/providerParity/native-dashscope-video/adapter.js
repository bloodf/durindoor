// DashScope video credential-variant adapters (#2034), staged for
// /v1/video/generations (VIDEO_GENERATION_ADAPTERS contract) and not
// registered (see ./registration.json). One adapter per identity: each one
// builds only its own source models (./request.js), sends only its selected
// connection's key, and only to its own fixed host (./job.js). Source
// attribution is in ./config.js.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { dashscopeVideoIdentity } from "./config.js";
import { runDashscopeVariantVideoJob } from "./job.js";
import { buildDashscopeVariantVideoRequest } from "./request.js";

const RESPONSE_FORMATS = Object.freeze(["url"]);
const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

/**
 * @param {string} providerId - qwen-cloud, qwen-cloud-token-plan or bailian-coding-plan
 * @param {object} [options] - job bounds and clock for tests: { timeoutMs, submitTimeoutMs,
 *   requestTimeoutMs, pollIntervalMs, wait, now }
 */
export function createDashscopeVariantVideoAdapter(providerId, options = {}) {
  const identity = dashscopeVideoIdentity(providerId);
  if (!identity) throw new Error(`Unknown DashScope video identity: ${providerId}`);
  const { now = Date.now } = options;
  return {
    async: true,
    provider: identity.id,
    models: identity.models,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** One video as `{ created, data: [{ url, format }] }`, or an error result (with `acceptedJob` when it may bill). */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        if (body?.response_format != null && !RESPONSE_FORMATS.includes(body.response_format)) {
          throw Object.assign(new Error(`${identity.label} video supports response_format url only`), { status: 400 });
        }
        request = buildDashscopeVariantVideoRequest(identity.id, model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runDashscopeVariantVideoJob({ ...options, providerId: identity.id, request, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the one video returned. Duration and cost are unknown here.
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
