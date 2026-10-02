import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { isBoolean, isString } from "../../../src/shared/utils/typeChecks.js";

const STATUS_MAP = {
  queued: "pending",
  running: "processing",
  succeeded: "done",
  failed: "failed",
  cancelled: "cancelled"
};

const badRequest = (message) => ({ error: createErrorResult(HTTP_STATUS.BAD_REQUEST, message) });

export const MINIMAX_V1_JOB_PREFIX = "minimax-v1:";

const LEGACY_STATUS_MAP = { Preparing: "pending", Queueing: "pending", Processing: "processing", Success: "done", Fail: "failed" };

/** Convert the public OpenAI-style video contract into MiniMax's v2 task API. */
export function prepareMinimaxVideoRequest(config, { action, requestId, rawBody, contentType }) {
  if (requestId) {
    return {
      method: "GET",
      url: `${config.queryUrl.replace(/\/$/, "")}/${encodeURIComponent(requestId)}`,
      body: undefined,
      contentType: null
    };
  }
  if (action !== "generations") return badRequest("MiniMax video generation supports the generations action only");
  if (!contentType?.includes("application/json")) return badRequest("MiniMax video generation requires an application/json request body");

  let input;
  try {
    input = JSON.parse(String(rawBody || ""));
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return badRequest("MiniMax video generation requires a JSON object");

  const suppliedContent = Array.isArray(input.content) ? input.content : [];
  const textPart = suppliedContent.find((part) => part?.type === "text" && isString(part.text) && part.text.trim());
  const prompt = isString(input.prompt) ? input.prompt.trim() : textPart?.text.trim();
  if (!prompt) return badRequest("MiniMax video generation requires nonempty text content");
  if (prompt.length > config.maxPromptCharacters) return badRequest(`MiniMax video generation prompts must not exceed ${config.maxPromptCharacters} characters`);
  if (suppliedContent.some((part) => !["text", "image_url", "video_url", "audio_url"].includes(part?.type))) {
    return badRequest("MiniMax video generation content contains an unsupported type");
  }

  const model = input.model || config.defaultModel;
  if (!config.models.includes(model)) return badRequest(`Unsupported MiniMax video model: ${model}`);
  const constraints = config.modelConstraints?.[model] || config;
  if (!constraints.resolutions.includes(input.resolution)) return badRequest(`MiniMax ${model} resolution must be one of: ${constraints.resolutions.join(", ")}`);
  if (!Number.isInteger(input.duration) || input.duration < constraints.duration.min || input.duration > constraints.duration.max) {
    return badRequest(`MiniMax ${model} duration must be an integer from ${constraints.duration.min} to ${constraints.duration.max} seconds`);
  }
  const ratio = input.ratio || input.aspect_ratio;
  if (!config.textToVideoRatios.includes(ratio)) return badRequest(`MiniMax text-to-video ratio must be one of: ${config.textToVideoRatios.join(", ")}`);

  const content = suppliedContent.length ? suppliedContent : [{ type: "text", text: prompt }];
  if (!textPart && suppliedContent.length) content.unshift({ type: "text", text: prompt });
  const body = { model, content, resolution: input.resolution, duration: input.duration, ratio };
  if (isString(input.callback_url) && input.callback_url) body.callback_url = input.callback_url;
  if (config.supportsAigcWatermark && isBoolean(input.aigc_watermark)) body.aigc_watermark = input.aigc_watermark;
  return { method: "POST", url: config.createUrl, body: JSON.stringify(body), contentType: "application/json" };
}

export function prepareMinimaxLegacyVideoRequest(config, { action, requestId, rawBody, contentType }) {
  if (requestId) return { method: "GET", url: `${config.legacyQueryUrl}?task_id=${encodeURIComponent(requestId)}`, body: undefined, contentType: null };
  if (action !== "generations") return badRequest("MiniMax legacy video generation supports the generations action only");
  if (!contentType?.includes("application/json")) return badRequest("MiniMax legacy video generation requires an application/json request body");
  let input;
  try { input = JSON.parse(String(rawBody || "")); } catch { return badRequest("Invalid JSON body"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return badRequest("MiniMax legacy video generation requires a JSON object");
  const model = input.model;
  const imageToVideo = isString(input.first_frame_image) && input.first_frame_image.trim().length > 0;
  if (!config.legacyModels?.includes(model)) return badRequest(`Unsupported MiniMax legacy video model: ${model}`);
  if (!imageToVideo && (!isString(input.prompt) || !input.prompt.trim())) return badRequest("MiniMax legacy text-to-video requires a prompt");
  if (isString(input.prompt) && input.prompt.length > 2000) return badRequest("MiniMax legacy video prompts must not exceed 2000 characters");
  const allowed = (imageToVideo ? config.legacyI2vConstraints : config.legacyT2vConstraints)?.[model]?.[input.duration];
  if (!allowed?.includes(input.resolution)) return badRequest(`MiniMax ${model} does not support ${input.duration}s ${input.resolution}`);
  const body = { model };
  for (const field of ["prompt", "first_frame_image", "prompt_optimizer", "fast_pretreatment", "duration", "resolution", "callback_url"]) if (input[field] !== undefined) body[field] = input[field];
  return { method: "POST", url: config.legacyCreateUrl, body: JSON.stringify(body), contentType: "application/json" };
}

export function normalizeMinimaxLegacyVideoResponse(bodyText, requestId = null) {
  let payload;
  try { payload = JSON.parse(bodyText); } catch { return { error: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MiniMax returned an invalid legacy video response") }; }
  if (!requestId) return payload?.task_id ? { bodyText: JSON.stringify({ request_id: `${MINIMAX_V1_JOB_PREFIX}${payload.task_id}` }) } : { error: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MiniMax did not return a video task id") };
  const status = payload?.status || payload?.task?.status;
  if (!status) return { error: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MiniMax did not return a legacy video task status") };
  const task = payload?.task || payload;
  return { bodyText: JSON.stringify({ request_id: `${MINIMAX_V1_JOB_PREFIX}${requestId}`, status: LEGACY_STATUS_MAP[status] || status, ...(task.content?.url ? { video: { url: task.content.url } } : null), ...(task.file_id ? { file_id: task.file_id } : null), ...(task.error ? { error: task.error } : null) }) };
}

/** Normalize MiniMax task responses to the existing `/v1/videos` job shape. */
export function normalizeMinimaxVideoResponse(bodyText, requestId = null) {
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { error: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MiniMax returned an invalid video response") };
  }

  if (!requestId) {
    return payload?.task_id ?
    { bodyText: JSON.stringify({ request_id: payload.task_id }) } :
    { error: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MiniMax did not return a video task id") };
  }

  const task = payload?.task;
  if (!task?.status) return { error: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MiniMax did not return a video task status") };
  const normalized = { request_id: task.id || requestId, status: STATUS_MAP[task.status] || task.status };
  if (task.content?.url) {
    normalized.video = {
      url: task.content.url,
      ...(Number.isInteger(task.duration) ? { duration: task.duration } : null),
      ...(task.resolution ? { resolution: task.resolution } : null),
      ...(task.ratio ? { aspect_ratio: task.ratio } : null)
    };
  }
  if (task.error) normalized.error = task.error;
  if (task.usage) normalized.usage = task.usage;
  return { bodyText: JSON.stringify(normalized) };
}