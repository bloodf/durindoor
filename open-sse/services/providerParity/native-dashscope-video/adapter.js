// DashScope video credential-variant adapters (#2034), staged for
// /v1/video/generations (VIDEO_GENERATION_ADAPTERS contract) and not
// registered (see ./registration.json). One adapter per identity: each one
// builds only its own source models (./request.js), sends only its selected
// connection's key, and only to its own fixed host (./job.js). Source
// attribution is in ./config.js.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { dashscopeVideoIdentity } from "./config.js";
import { resolveDashscopeVideoPolling, runDashscopeVariantVideoJob } from "./job.js";
import { buildDashscopeVariantVideoRequest } from "./request.js";

const RESPONSE_FORMATS = Object.freeze(["url"]);
const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

/**
 * @param {string} providerId - qwen-cloud, qwen-cloud-token-plan or bailian-coding-plan
 * @param {object} [options] - job bounds and clock for tests: { timeoutMs, submitTimeoutMs,
 *   requestTimeoutMs, pollIntervalMs, wait, now }; `timeoutMs` and `pollIntervalMs` are the
 *   defaults a caller's `timeout_ms` / `poll_interval_ms` replace within bounds. `regional`:
 *   true resolves the connection's region to the identity's fixed regional host
 *   (../native-dashscope-image/regions.js) instead of accepting global-sg only.
 */
export function createDashscopeVariantVideoAdapter(providerId, options = {}) {
  const identity = dashscopeVideoIdentity(providerId);
  if (!identity) throw new Error(`Unknown DashScope video identity: ${providerId}`);
  const { now = Date.now, regional = false } = options;
  return {
    async: true,
    provider: identity.id,
    models: identity.models,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    regions: Object.freeze(regional ? ["global-sg", "china-beijing"] : ["global-sg"]),
    /** One video as `{ created, data: [{ url, format }] }`, or an error result (with `acceptedJob` when it may bill). */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      let polling;
      try {
        if (body?.response_format != null && !RESPONSE_FORMATS.includes(body.response_format)) {
          throw Object.assign(new Error(`${identity.label} video supports response_format url only`), { status: 400 });
        }
        polling = resolveDashscopeVideoPolling(body, options);
        request = buildDashscopeVariantVideoRequest(identity.id, model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runDashscopeVariantVideoJob({
        ...options,
        timeoutMs: polling.timeoutMs,
        pollIntervalMs: polling.pollIntervalMs,
        regional,
        providerId: identity.id,
        request,
        credentials,
        signal,
        log,
      });
      if (!result.success) return result;
      // Usage counts the one video returned. Duration and cost are unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: {
          ...result.accounting.meta,
          jobId: result.taskId,
          nativeUnitsSource: "returned-videos",
        },
      };
      if (regional) {
        accounting.meta.region = result.region;
        accounting.meta.pollTimeoutMs = polling.timeoutMs;
        accounting.meta.pollIntervalMs = polling.pollIntervalMs;
      }
      const payload = { created: Math.floor(now() / 1000), data: [{ url: result.url, format: "mp4" }] };
      return { success: true, accounting, response: jsonResponse(payload) };
    },
  };
}
