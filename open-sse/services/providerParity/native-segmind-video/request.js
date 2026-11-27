// Segmind video request body: the source mapping with every value checked
// before anything is sent.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/videoGeneration/providers/segmind.ts
// (buildSegmindVideoBody: `prompt`, then `negative_prompt` when a string,
// `seed` when a number, `duration` as Number(duration) when given, and
// `aspect_ratio` when a string; nothing else is forwarded).
//
// Fork deviations: the source dropped mistyped values silently and sent
// `Number("5s")` as null. Here a mistyped or out-of-range value, `n` above 1,
// `stream`, and any field the source would drop that changes the output
// (input media, size, resolution, fps, OpenAI `seconds`) is refused with a 400
// before submit, so a billable request never runs without the caller's input.
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { segmindVideoSlug, segmindVideoUrl } from "./config.js";

export const SEGMIND_VIDEO_MAX_PROMPT_LENGTH = 10_000;
export const SEGMIND_VIDEO_MAX_DURATION_SECONDS = 60;
const ASPECT_RATIO_RE = /^[1-9]\d{0,1}:[1-9]\d{0,1}$/;
const NUMERIC_RE = /^\d+(?:\.\d+)?$/;
const MAX_SEED = 2 ** 32 - 1;

/** Fields the source never forwards whose loss would change the video; refused, not dropped. */
export const SEGMIND_VIDEO_REFUSED_FIELDS = Object.freeze([
  "image", "image_url", "image_urls", "images", "input_image", "input_reference", "reference_images",
  "first_frame", "last_frame", "video", "video_url", "audio", "audio_url", "mask",
  "size", "resolution", "quality", "fps", "width", "height", "seconds",
]);

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

function duration(value) {
  const number = isString(value) && NUMERIC_RE.test(value.trim()) ? Number(value.trim()) : value;
  if (!isNumber(number) || !Number.isFinite(number) || number <= 0 || number > SEGMIND_VIDEO_MAX_DURATION_SECONDS) {
    throw invalid(`duration must be a number of seconds above 0 and at most ${SEGMIND_VIDEO_MAX_DURATION_SECONDS}`);
  }
  return number;
}

/**
 * `{ slug, url, body }` for one Segmind video request, or throws an Error with
 * `status` 400 naming the refused input.
 */
export function buildSegmindVideoRequest(model, body) {
  const slug = segmindVideoSlug(model);
  if (!isRecord(body)) throw invalid("The request body must be an object");
  const { prompt } = body;
  if (!isString(prompt) || !prompt.trim()) throw invalid("prompt must be a non-empty string");
  if (prompt.length > SEGMIND_VIDEO_MAX_PROMPT_LENGTH) throw invalid(`prompt must be at most ${SEGMIND_VIDEO_MAX_PROMPT_LENGTH} characters`);
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw invalid("Segmind returns one video per request; n must be 1");
  if (body.stream !== undefined && body.stream !== null && body.stream !== false) throw invalid("Segmind video does not stream");
  for (const field of SEGMIND_VIDEO_REFUSED_FIELDS) {
    if (body[field] !== undefined && body[field] !== null) {
      throw invalid(field === "seconds"
        ? "Use duration for Segmind video length; seconds is not forwarded"
        : `Segmind video does not accept ${field} through this gateway`);
    }
  }

  const upstream = { prompt };
  if (body.negative_prompt !== undefined && body.negative_prompt !== null) {
    if (!isString(body.negative_prompt)) throw invalid("negative_prompt must be a string");
    if (body.negative_prompt.length > SEGMIND_VIDEO_MAX_PROMPT_LENGTH) throw invalid("negative_prompt is too long");
    upstream.negative_prompt = body.negative_prompt;
  }
  if (body.seed !== undefined && body.seed !== null) {
    if (!Number.isInteger(body.seed) || body.seed < 0 || body.seed > MAX_SEED) throw invalid("seed must be a whole number from 0 to 4294967295");
    upstream.seed = body.seed;
  }
  if (body.duration !== undefined && body.duration !== null) upstream.duration = duration(body.duration);
  if (body.aspect_ratio !== undefined && body.aspect_ratio !== null) {
    if (!isString(body.aspect_ratio) || !ASPECT_RATIO_RE.test(body.aspect_ratio)) throw invalid("aspect_ratio must look like 16:9");
    upstream.aspect_ratio = body.aspect_ratio;
  }
  return { slug, url: segmindVideoUrl(slug), body: upstream };
}
