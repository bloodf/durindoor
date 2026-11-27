// OpenAI-shaped video envelopes over the xAI job API, ported from CLIProxyAPI
// 47f18e4d (sdk/api/handlers/openai/openai_videos_handlers.go:
// buildVideosCreateAPIResponseFromXAI, buildVideosRetrieveAPIResponseFromXAI,
// setOpenAIVideoErrorFromXAIDoc, xaiVideoContentURLFromPayload,
// openAIVideoStatus, VideosContent). These are pure normalizers plus one
// bounded status read for content. They are staged for a future OpenAI
// `POST /v1/videos`, `GET /v1/videos/{id}` and `GET /v1/videos/{id}/content`
// surface; the gateway's existing native `/v1/videos/*` proxy keeps returning
// xAI's own JSON.
//
// Fork deviations: the upstream `error.message` (which CPA copied into the
// client body) is replaced by a fixed message, only a vendor code of a safe
// shape is kept; `video_url` and the content URL must be public https (CPA
// accepted http and any host); content is resolved to a URL, never downloaded
// or streamed by the gateway; the content `variant` other than "video" is a
// 400 as in CPA.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { XAI_REQUEST_TIMEOUT_MS, XAI_VIDEO_MODELS, xaiVideoModel } from "./config.js";
import { xaiCredential, xaiErrorCode, xaiPublicUrl, xaiSecrets } from "./http.js";
import { XAI_REQUEST_ID_RE, fetchXaiVideoStatus, settleXaiStatus, xaiVideoSeconds } from "./job.js";

const DEFAULT_MODEL = XAI_VIDEO_MODELS[0].id;
const PASSTHROUGH_FIELDS = ["created_at", "completed_at", "expires_at"];

/** CPA openAIVideoStatus: the OpenAI video status for an xAI status, or "" when unknown. */
export function openAIVideoStatus(status) {
  switch (isString(status) ? status.trim().toLowerCase() : "") {
    case "queued": case "pending": return "queued";
    case "in_progress": case "processing": case "running": return "in_progress";
    case "completed": case "done": case "succeeded": case "success": return "completed";
    case "failed": case "error": case "expired": case "cancelled": case "canceled": return "failed";
    default: return "";
  }
}

const canonicalModel = (model) => xaiVideoModel(model)?.id ?? DEFAULT_MODEL;

function videoError(answer, status) {
  const hasError = answer.error !== undefined && answer.error !== null && answer.error !== "";
  const code = xaiErrorCode(answer);
  if (!hasError && !code && status !== "failed") return null;
  return { code: code ?? "video_generation_failed", message: "Video generation failed" };
}

/**
 * The OpenAI `video` object for an accepted xAI create answer (`{ request_id }`).
 * `meta` is the request metadata from buildXaiVideoRequest; `createdAt` is unix seconds.
 */
export function openAIVideoFromXaiCreate(answer, meta, createdAt = Math.floor(Date.now() / 1000)) {
  const id = isRecord(answer) ? (answer.request_id ?? answer.id) : null;
  if (!isString(id) || !XAI_REQUEST_ID_RE.test(id)) return null;
  const out = {
    object: "video", id, model: canonicalModel(meta?.model), status: openAIVideoStatus(answer.status) || "queued",
    progress: Number.isFinite(answer.progress) ? answer.progress : 0,
    prompt: meta?.prompt ?? null, created_at: createdAt,
  };
  if (meta?.seconds != null) out.seconds = meta.seconds;
  if (meta?.size != null) out.size = meta.size;
  return out;
}

/** The OpenAI `video` object for an xAI status answer about `videoId`. */
export function openAIVideoFromXaiStatus(videoId, answer, fallbackModel = DEFAULT_MODEL) {
  if (!isRecord(answer)) return null;
  const out = { object: "video", id: videoId, model: isString(answer.model) && xaiVideoModel(answer.model) ? xaiVideoModel(answer.model).id : canonicalModel(fallbackModel) };
  for (const field of PASSTHROUGH_FIELDS) if (Number.isFinite(answer[field])) out[field] = answer[field];
  const status = openAIVideoStatus(answer.status);
  if (status) out.status = status;
  if (Number.isFinite(answer.progress)) out.progress = answer.progress;
  const seconds = xaiVideoSeconds(answer);
  if (seconds !== null) out.seconds = String(seconds);
  const url = status === "completed" ? xaiPublicUrl(answer.video?.url) : null;
  if (url) out.video_url = url;
  const error = videoError(answer, status);
  if (error) {
    out.status ??= "failed";
    out.progress ??= 0;
    out.error = error;
  }
  return out;
}

/**
 * Resolve `GET /v1/videos/{id}/content` to the finished video's public https
 * URL with one bounded status read on the selected connection. The bytes are
 * never fetched by the gateway. Returns `{ success: true, url }` or an error result.
 */
export async function resolveXaiVideoContent({ videoId, variant = "video", credentials, signal, timeoutMs = XAI_REQUEST_TIMEOUT_MS }) {
  if (variant !== "video") return createErrorResult(HTTP_STATUS.BAD_REQUEST, `variant "${String(variant).slice(0, 32)}" is not available for xAI video downloads`);
  if (!isString(videoId) || !XAI_REQUEST_ID_RE.test(videoId)) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "video_id is required");
  const credential = xaiCredential(credentials);
  if (!credential) return createErrorResult(401, "xAI API key or OAuth access token is required");
  const secrets = xaiSecrets(credentials);
  try {
    const answer = await fetchXaiVideoStatus(videoId, {
      token: credential.token, proxyOptions: resolveCredentialProxyOptions(credentials), signal, timeoutMs,
    });
    const settled = settleXaiStatus(answer, videoId);
    if (settled.state !== "done") return createErrorResult(409, "xAI video is not ready yet");
    return { success: true, url: settled.url };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return createErrorResult(499, "xAI video request aborted");
    const status = Number(error?.status);
    return createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : "Invalid response from xAI", undefined, undefined, null, secrets
    );
  }
}
