// MiniMax native video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`minimax`: baseUrl
// https://api.minimax.io/v1/video_generation, statusUrl
// https://api.minimax.io/v1/query/video_generation, authType "apikey",
// authHeader "bearer", filesUrl https://api.minimax.io/v1/files/retrieve,
// format "minimax-video", models MiniMax-Hailuo-2.3, MiniMax-Hailuo-02,
// T2V-01-Director). Wire behavior comes from open-sse/handlers/videoGeneration.ts
// (format dispatch) and open-sse/handlers/videoGeneration/minimaxHandler.ts:
// `POST {baseUrl}` with a Bearer key answers `{ task_id, base_resp }`, then
// `GET {statusUrl}?task_id=<id>` answers `{ status, file_id, base_resp }`, then
// `GET {filesUrl}?file_id=<id>` answers `{ file: { download_url }, base_resp }`.
// MiniMax reports application errors in `base_resp.status_code` (0 = ok), also on
// HTTP 200.
//
// The existing `minimax` provider (open-sse/providers/registry/minimax.js, alias
// `minimax`) keeps its API-key connection mode. Its `videoConfig` (format
// `minimax-multi`) already reaches the same three v1 endpoints through the async
// /v1/videos job proxy (open-sse/handlers/videoCore.js, `minimax-v1:` job ids).
// This module is the synchronous /v1/video/generations adapter the source used,
// which that proxy does not provide.

export const MINIMAX_PROVIDER_ID = "minimax";
export const MINIMAX_ALIAS = "minimax";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const MINIMAX_ORIGIN = "https://api.minimax.io";
export const MINIMAX_VIDEO_CREATE_URL = `${MINIMAX_ORIGIN}/v1/video_generation`;
export const MINIMAX_VIDEO_QUERY_URL = `${MINIMAX_ORIGIN}/v1/query/video_generation`;
export const MINIMAX_FILES_RETRIEVE_URL = `${MINIMAX_ORIGIN}/v1/files/retrieve`;
export const MINIMAX_AUTH_HEADER = "Authorization";
export const MINIMAX_AUTH_SCHEME = "Bearer";
export const MINIMAX_VIDEO_FORMAT = "minimax-video";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/**
 * The source's static list, in source order. `textToVideo` maps each duration to
 * the resolutions MiniMax accepts for text-to-video; `imageToVideo` does the same
 * with a first frame (null when the model has no image-to-video mode). The
 * source accepted 6 or 10 s and 720P/768P/1080P for every model; the
 * per-model tables come from the local `videoConfig.legacyT2vConstraints` /
 * `legacyI2vConstraints` and MiniMax's T2V-01-Director documentation (6 s, 720P,
 * text only), so a combination MiniMax would refuse is refused before submit.
 */
export const MINIMAX_VIDEO_MODELS = freezeAll([
  {
    id: "MiniMax-Hailuo-2.3", name: "Hailuo 2.3", kind: "video",
    textToVideo: Object.freeze({ 6: Object.freeze(["768P", "1080P"]), 10: Object.freeze(["768P"]) }),
    imageToVideo: Object.freeze({ 6: Object.freeze(["768P", "1080P"]), 10: Object.freeze(["768P"]) }),
  },
  {
    id: "MiniMax-Hailuo-02", name: "Hailuo 02", kind: "video",
    textToVideo: Object.freeze({ 6: Object.freeze(["768P", "1080P"]), 10: Object.freeze(["768P"]) }),
    imageToVideo: Object.freeze({ 6: Object.freeze(["512P", "768P", "1080P"]), 10: Object.freeze(["512P", "768P"]) }),
  },
  {
    id: "T2V-01-Director", name: "T2V 01 Director", kind: "video",
    textToVideo: Object.freeze({ 6: Object.freeze(["720P"]) }),
    imageToVideo: null,
  },
]);

export const minimaxVideoModel = (id) => MINIMAX_VIDEO_MODELS.find((model) => model.id === id) ?? null;

export const minimaxQueryUrl = (taskId) => `${MINIMAX_VIDEO_QUERY_URL}?task_id=${encodeURIComponent(taskId)}`;
export const minimaxFileUrl = (fileId) => `${MINIMAX_FILES_RETRIEVE_URL}?file_id=${encodeURIComponent(fileId)}`;

// Source task states (minimaxHandler.ts normalizeMinimaxTaskStatus), compared
// case-insensitively. Anything else is still pending.
export const MINIMAX_SUCCESS_STATUSES = Object.freeze(["success"]);
export const MINIMAX_FAILED_STATUSES = Object.freeze(["fail", "failed"]);

// Source base_resp.status_code mapping (minimaxCodeToHttpStatus). These codes
// are refusals: MiniMax did not take the work.
export const MINIMAX_RATE_LIMIT_CODE = 1002;
export const MINIMAX_REFUSAL_CODES = Object.freeze({
  1004: 401, 2049: 401, // auth failed / invalid key
  1008: 402, // insufficient balance
  1002: 429, 1039: 429, // rate / token limit
  1026: 400, 2013: 400, // sensitive input / invalid parameters
});

// Source bounds: a 300 s job deadline and a 5 s poll interval, with the caller's
// `timeout_ms` (up to 600 s) and `poll_interval_ms` (up to 120 s) honored through
// utils/pollBounds.ts. A 1 s floor on the interval is added here.
export const MINIMAX_JOB_TIMEOUT_MS = 300_000;
export const MINIMAX_POLL_INTERVAL_MS = 5_000;
export const MINIMAX_MAX_JOB_TIMEOUT_MS = 600_000;
export const MINIMAX_MAX_POLL_INTERVAL_MS = 120_000;
export const MINIMAX_MIN_POLL_INTERVAL_MS = 1_000;
// Gateway bounds: each submit and each status or file request.
export const MINIMAX_SUBMIT_TIMEOUT_MS = 30_000;
export const MINIMAX_REQUEST_TIMEOUT_MS = 30_000;
// Source pollRetry.ts: 5 consecutive transient retries, backoff capped at 30 s.
export const MINIMAX_MAX_POLL_RETRIES = 5;
export const MINIMAX_MAX_RETRY_DELAY_MS = 30_000;
