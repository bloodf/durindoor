// Novita native video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`novita`: baseUrl
// https://api.novita.ai/v3/async, statusUrl
// https://api.novita.ai/v3/async/task-result, authType "apikey", authHeader
// "bearer", format "novita-video", models wan-t2v, kling-v1.6-t2v). Wire
// behavior comes from open-sse/handlers/videoGeneration.ts (format dispatch),
// open-sse/handlers/videoGeneration/novita.ts (pure helpers) and
// open-sse/handlers/videoGeneration/novitaHandler.ts (orchestration):
// `POST {baseUrl}/{model}` with a Bearer key answers `{ task_id }`, then
// `GET {statusUrl}?task_id=<id>` with the same key answers
// `{ task: { status, reason }, videos: [{ video_url }] }`.
//
// The existing `novita` provider (open-sse/providers/registry/novita.js, alias
// `novita`) keeps its API-key connection mode and default Bearer header; video
// uses the selected connection's key. Its chat base URL and its /openai/v1/models
// discovery are never used here.

export const NOVITA_PROVIDER_ID = "novita";
export const NOVITA_ALIAS = "novita";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const NOVITA_ORIGIN = "https://api.novita.ai";
export const NOVITA_ASYNC_BASE_URL = `${NOVITA_ORIGIN}/v3/async`;
export const NOVITA_TASK_RESULT_URL = `${NOVITA_ASYNC_BASE_URL}/task-result`;
export const NOVITA_AUTH_HEADER = "Authorization";
export const NOVITA_AUTH_SCHEME = "Bearer";
export const NOVITA_VIDEO_FORMAT = "novita-video";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** The source's static list, in source order. The model id is the submit path segment. */
export const NOVITA_VIDEO_MODELS = freezeAll([
  { id: "wan-t2v", name: "Wan 2.1 Text-to-Video", kind: "video" },
  { id: "kling-v1.6-t2v", name: "Kling V1.6 Text-to-Video", kind: "video" },
]);

export const novitaVideoModel = (id) => NOVITA_VIDEO_MODELS.find((model) => model.id === id) ?? null;

/** The submit URL for a listed model. Model ids are fixed, so the path is too. */
export const novitaSubmitUrl = (model) => `${NOVITA_ASYNC_BASE_URL}/${model.id}`;
/** The shared poll URL for a task id. */
export const novitaTaskResultUrl = (taskId) => `${NOVITA_TASK_RESULT_URL}?task_id=${encodeURIComponent(taskId)}`;

// Source task states (novita.ts NOVITA_TERMINAL_SUCCESS / NOVITA_TERMINAL_FAILURE).
export const NOVITA_SUCCESS_STATUSES = Object.freeze(["TASK_STATUS_SUCCEED", "SUCCEED", "SUCCEEDED"]);
export const NOVITA_FAILED_STATUSES = Object.freeze(["TASK_STATUS_FAILED", "FAILED"]);
/** A source failure state that does not say whether the work ran; kept as accepted work here. */
export const NOVITA_UNKNOWN_STATUSES = Object.freeze(["UNKNOWN_ERROR"]);

// Source bounds: a 300 s job deadline and a 2.5 s poll interval. The source let
// the caller set `timeout_ms` (up to 600 s) and `poll_interval_ms` (up to 120 s)
// through utils/pollBounds.ts; the same ceilings apply here, with a 1 s floor
// on the interval that the source lacked.
export const NOVITA_JOB_TIMEOUT_MS = 300_000;
export const NOVITA_POLL_INTERVAL_MS = 2_500;
export const NOVITA_MAX_JOB_TIMEOUT_MS = 600_000;
export const NOVITA_MAX_POLL_INTERVAL_MS = 120_000;
export const NOVITA_MIN_POLL_INTERVAL_MS = 1_000;
// Gateway bounds: each submit and each status request.
export const NOVITA_SUBMIT_TIMEOUT_MS = 30_000;
export const NOVITA_REQUEST_TIMEOUT_MS = 30_000;
export const NOVITA_MAX_POLL_RETRIES = 5;
export const NOVITA_MAX_RETRY_DELAY_MS = 30_000;
