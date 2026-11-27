// DeepInfra native video adapter, staged for /v1/video/generations
// (VIDEO_GENERATION_ADAPTERS contract) and not registered (see
// ./registration.json). One synchronous POST per call; see ./config.js for the
// source attribution.
//
// Fork deviations from the source handler: the key goes only to
// https://api.deepinfra.com (connection base URLs are ignored); the call is
// bounded by one deadline and the caller's signal; redirects are refused; the
// body read is size and time bounded; upstream text (`detail`,
// `inference_status.error`) never reaches an error message; a send whose
// outcome is unknown (timeout, abort, 5xx, unreadable 2xx, 2xx without a usable
// URL) carries `acceptedJob` with unknown cost and is never resent; only public
// https result URLs are returned (never data URLs) and they are never fetched.
import { createErrorResult, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DEEPINFRA_MAX_RESPONSE_BYTES, DEEPINFRA_PROVIDER_ID, DEEPINFRA_VIDEO_MODELS, DEEPINFRA_VIDEO_TIMEOUT_MS,
  deepinfraVideoModel, deepinfraVideoUrl,
} from "./config.js";
import {
  boundedFetch, deepinfraHeaders, deepinfraPublicUrl, deepinfraSecrets, deepinfraToken, provenUnsent, redirectState,
  refusedAnswer, withAcceptedJob,
} from "./http.js";
import { buildDeepinfraVideoRequest } from "./request.js";

const RESPONSE_FORMATS = Object.freeze(["url"]);
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});
const aborted = () => createErrorResult(499, "DeepInfra video request aborted");
const unknown = (message, status = HTTP_STATUS.BAD_GATEWAY, jobState = "completed-unusable") =>
  withAcceptedJob(createErrorResult(status, `DeepInfra ${message}`), jobState);

// Numeric inference_status fields kept as metadata only; `cost` is not
// interpreted as USD because the source never did and no receipt contract
// exists for it here.
function reportedStatus(answer) {
  const status = isRecord(answer.inference_status) ? answer.inference_status : null;
  if (!status) return null;
  const kept = {};
  if (isString(status.status) && status.status.length <= 32) kept.status = status.status;
  for (const field of ["runtime_ms", "cost"]) {
    if (isNumber(status[field]) && Number.isFinite(status[field])) kept[field] = status[field];
  }
  return Object.keys(kept).length ? kept : null;
}

/**
 * Settle one 2xx answer. Returns `{ url, requestId, inferenceStatus }` or an
 * error result. DeepInfra has done (and may bill) the render once it answers
 * 2xx, so every failure here carries `acceptedJob`.
 */
async function settle(response, { signal, timeoutMs }) {
  let text;
  try {
    text = await readBoundedResponseText(response, { signal, maxBytes: DEEPINFRA_MAX_RESPONSE_BYTES, timeoutMs, throwOnTimeout: true });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(aborted(), "accepted");
    return unknown("video answer could not be read", error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY);
  }
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  if (!isRecord(answer)) return unknown("returned an unreadable video answer");
  const inferenceStatus = reportedStatus(answer);
  if (inferenceStatus?.status && inferenceStatus.status.toLowerCase() === "failed") {
    return unknown("reported the video inference as failed", HTTP_STATUS.BAD_GATEWAY, "failed-reported");
  }
  const url = deepinfraPublicUrl(answer.video_url);
  if (!url) return unknown("video generation did not return a usable public video URL");
  const requestId = isString(answer.request_id) && REQUEST_ID_RE.test(answer.request_id) ? answer.request_id : null;
  return { url, requestId, inferenceStatus };
}

/**
 * @param {object} [options] - bounds and clock for tests: { timeoutMs, now }
 */
export function createDeepinfraVideoAdapter(options = {}) {
  const { timeoutMs = DEEPINFRA_VIDEO_TIMEOUT_MS, now = Date.now } = options;
  return {
    // Work in flight may bill even though the call is synchronous.
    async: true,
    provider: DEEPINFRA_PROVIDER_ID,
    models: DEEPINFRA_VIDEO_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /** One video as `{ created, data: [{ url, format }] }`, or an error result (with `acceptedJob` when it may bill). */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildDeepinfraVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = deepinfraToken(credentials);
      if (!token) return createErrorResult(401, "DeepInfra API key is required");
      if (signal?.aborted) return aborted();
      const secrets = deepinfraSecrets(credentials);
      const deadline = now() + timeoutMs;
      const remaining = () => Math.max(1, deadline - now());

      let response;
      try {
        response = await boundedFetch(deepinfraVideoUrl(deepinfraVideoModel(model)), {
          method: "POST",
          headers: deepinfraHeaders(token),
          body: JSON.stringify(request),
          redirect: "manual",
          proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: remaining() });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? aborted() : withAcceptedJob(aborted(), "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "DeepInfra video request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return unknown(
          `video request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          "submit-unknown"
        );
      }

      const redirect = redirectState(response);
      if (redirect?.refused) {
        log?.debug?.("DEEPINFRA", "video redirect refused");
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "DeepInfra video redirect refused");
      }
      if (redirect?.foreign) return unknown("video request was redirected", HTTP_STATUS.BAD_GATEWAY, "submit-unknown");
      if (!response.ok) return refusedAnswer(response, { secrets, now });

      const settled = await settle(response, { signal, timeoutMs: remaining() });
      if (!settled.url) return settled;
      // Usage counts the video returned. Cost is unknown here.
      const accounting = mediaAccounting(null, DEEPINFRA_PROVIDER_ID, "video");
      accounting.nativeUnits = { videos: 1 };
      accounting.meta = { nativeUnitsSource: "returned-videos" };
      if (settled.requestId) accounting.meta.requestId = settled.requestId;
      if (settled.inferenceStatus) accounting.meta.providerMetadata = { path: "inference_status", value: settled.inferenceStatus };
      const payload = { created: Math.floor(now() / 1000), data: [{ url: settled.url, format: "mp4" }] };
      return { success: true, accounting, response: jsonResponse(payload) };
    },
  };
}
