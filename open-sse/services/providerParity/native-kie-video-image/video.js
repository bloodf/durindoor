// KIE native video generation: one Market createTask and a bounded
// recordInfo poll. Staged for /v1/video/generations and not registered (see
// ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`kie`, format "kie-video") and
// open-sse/handlers/videoGeneration.ts (handleKieVideoGeneration: body
// `{ model, input: { prompt, duration: String(duration) || "5",
// aspect_ratio || "16:9", sound: sound === true } }` to POST
// /api/v1/jobs/createTask, poll the registry statusUrl, result URLs from
// resultJson.resultUrls, then resultJson.videoUrls, then data.response.resultUrls,
// each item `{ url, format: "mp4" }`).
//
// Fork deviations (beyond ./job.js): image-to-video catalog rows are refused
// before submit because the source body never carries an input image; image
// inputs, n > 1, streaming and non-url response formats are refused instead of
// dropped; duration must be a whole number of seconds (1-60) and aspect_ratio
// must look like 16:9; caller `timeout_ms` / `poll_interval_ms` are not
// honored (fixed bounds); a success without a usable public https URL is an
// unknown outcome, not an empty 200.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  KIE_MARKET_CREATE_URL, KIE_MARKET_STATUS_URL, KIE_PROVIDER_ID, KIE_VIDEO_MODELS, KIE_VIDEO_UNSUPPORTED_MODELS,
  kieVideoModel,
} from "./config.js";
import { kieResultJson, runKieTask } from "./job.js";

const MODALITY = "video";
const MAX_PROMPT_CHARS = 32_000;
const RATIO_RE = /^\d{1,3}:\d{1,3}$/;
const DURATION_RE = /^\d{1,2}$/;
const IMAGE_FIELDS = ["image", "image_url", "image_urls", "imageUrls", "input_reference", "first_frame", "last_frame"];

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });

function durationOf(value) {
  if (value === undefined || value === null || value === "" || value === 0) return "5";
  const text = isNumber(value) ? String(value) : isString(value) ? value.trim() : null;
  if (!text || !DURATION_RE.test(text) || Number(text) < 1 || Number(text) > 60) throw reject("KIE video duration must be a whole number of seconds from 1 to 60");
  return String(Number(text));
}

/**
 * The KIE Market createTask body for an OpenAI-style video request. Throws a
 * 400 error for an unknown or unsupported model or an input this subset
 * cannot honor.
 */
export function buildKieVideoRequest(model, body) {
  if (!kieVideoModel(model)) throw reject(`Unsupported KIE video model: ${model}. Use one of: ${KIE_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  if (KIE_VIDEO_UNSUPPORTED_MODELS.includes(model)) throw reject(`KIE video model ${model} needs an input image, which this gateway does not send yet`);
  if (!isRecord(body)) throw reject("KIE video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("KIE video generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`KIE video prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  const image = IMAGE_FIELDS.find((field) => body[field] !== undefined && body[field] !== null);
  if (image) throw reject(`KIE video generation does not take ${image} here (text-to-video only)`);
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw reject("KIE video generation returns one video per request (n=1)");
  if (body.stream) throw reject("KIE video generation does not support streaming");
  if (body.aspect_ratio !== undefined && (!isString(body.aspect_ratio) || !RATIO_RE.test(body.aspect_ratio))) {
    throw reject("aspect_ratio must look like 16:9");
  }
  if (body.sound !== undefined && !isBoolean(body.sound)) throw reject("sound must be a boolean");
  return {
    model,
    input: {
      prompt: body.prompt,
      duration: durationOf(body.duration),
      aspect_ratio: body.aspect_ratio ?? "16:9",
      sound: body.sound === true,
    },
  };
}

/** The source's normalizeKieVideoResult: the first present list wins. */
export function kieVideoResultCandidates(record) {
  const resultJson = kieResultJson(record);
  const data = isRecord(record?.data) ? record.data : {};
  const response = isRecord(data.response) ? data.response : {};
  if (Array.isArray(resultJson.resultUrls)) return [resultJson.resultUrls];
  if (Array.isArray(resultJson.videoUrls)) return [resultJson.videoUrls];
  if (Array.isArray(response.resultUrls)) return [response.resultUrls];
  return [];
}

/**
 * @param {object} [options] - task bounds and clock, for tests; see runKieTask
 */
export function createKieVideoAdapter(options = {}) {
  return {
    async: true,
    provider: KIE_PROVIDER_ID,
    models: KIE_VIDEO_MODELS,
    responseFormats: Object.freeze(["url"]),
    defaultResponseFormat: "url",
    /**
     * Generate one video for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url, format }] }`, or an error result that carries
     * `acceptedJob` when the task may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      const requested = body?.response_format ?? "url";
      if (requested !== "url") return createErrorResult(HTTP_STATUS.BAD_REQUEST, "KIE video supports response_format url only");
      let request;
      try {
        request = buildKieVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runKieTask({
        ...options,
        modality: MODALITY,
        createUrl: KIE_MARKET_CREATE_URL,
        statusUrl: KIE_MARKET_STATUS_URL,
        request,
        extractUrls: kieVideoResultCandidates,
        credentials,
        signal,
        log,
      });
      if (!result.success) return result;
      const data = result.urls.map((url) => ({ url, format: "mp4" }));
      // Usage counts the videos returned. Duration billing and cost are unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: data.length },
        meta: { ...result.accounting.meta, nativeUnitsSource: "returned-videos" },
      };
      return {
        success: true,
        accounting,
        response: new Response(JSON.stringify({ created: Math.floor(Date.now() / 1000), data }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    },
  };
}
