// Vertex Veo request body: `{ instances: [{ prompt }], parameters }` for
// `:predictLongRunning`. Everything the adapter cannot send is refused here,
// before any credential is used or anything billable is submitted.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/videoGeneration.ts (handleVertexVeoGeneration: aspect
// ratio from `aspect_ratio`, `aspectRatio` or `size`; duration from
// `duration` or `durationSeconds`; `negative_prompt`) and
// open-sse/executors/vertexMedia.ts (vertexGenerateVideo: instance `prompt`,
// parameters `sampleCount` 1, `aspectRatio`, `durationSeconds`,
// `negativePrompt`).
//
// Fork deviations: the source drops a duration that is not a number and
// forwards any aspect ratio or `size` string raw; here both are checked
// against the model and refused when they do not fit. The source handler
// never forwards an image, so image-to-video and any other media input is
// refused instead of being silently dropped. Only one video is generated.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { VERTEX_VIDEO_ASPECT_RATIOS, VERTEX_VIDEO_MODEL_IDS, vertexVideoModel } from "./config.js";

// Media inputs the source handler never forwards.
const MEDIA_FIELDS = Object.freeze([
  "image", "image_url", "imageUrl", "image_urls", "imageUrls", "images", "input_reference",
  "first_frame_image", "last_frame", "last_frame_image", "lastFrame", "reference_images", "referenceImages",
  "video", "video_url", "videoUrl", "audio", "audio_url", "media", "content",
]);

const invalid = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });

function pickOne(body, names, label, check) {
  const present = names.filter((name) => body[name] !== undefined && body[name] !== null);
  if (!present.length) return undefined;
  const values = present.map((name) => body[name]);
  for (const value of values) check(value);
  if (values.some((value) => value !== values[0])) throw invalid(`Vertex Veo ${label} fields disagree: ${present.join(", ")}`);
  return values[0];
}

/**
 * Build the `:predictLongRunning` body for one Veo text-to-video request.
 *
 * @param {string} model - one of VERTEX_VIDEO_MODEL_IDS
 * @param {object} body - the public request body
 * @returns {{ instances: object[], parameters: object }}
 * @throws {Error} with `status` 400 for anything that cannot be sent
 */
export function buildVertexVideoRequest(model, body) {
  const entry = vertexVideoModel(model);
  if (!entry) throw invalid(`Unsupported Vertex video model: ${model}. Supported: ${VERTEX_VIDEO_MODEL_IDS.join(", ")}`);
  if (!isRecord(body)) throw invalid("Vertex Veo request body must be a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw invalid("Vertex Veo requires a nonempty text prompt");
  if (body.stream === true) throw invalid("Vertex Veo video generation does not stream");

  const media = MEDIA_FIELDS.filter((name) => body[name] !== undefined && body[name] !== null);
  if (media.length) throw invalid(`Vertex Veo supports text-to-video only; remove ${media.join(", ")}`);

  for (const name of ["n", "sampleCount", "sample_count"]) {
    if (body[name] !== undefined && body[name] !== 1) throw invalid(`Vertex Veo generates one video per request; ${name} must be 1`);
  }

  const aspectRatio = pickOne(body, ["aspect_ratio", "aspectRatio", "size"], "aspect ratio", (value) => {
    if (!VERTEX_VIDEO_ASPECT_RATIOS.includes(value)) {
      throw invalid(`Vertex Veo aspect ratio must be one of: ${VERTEX_VIDEO_ASPECT_RATIOS.join(", ")}`);
    }
  });
  const durationSeconds = pickOne(body, ["duration", "durationSeconds"], "duration", (value) => {
    if (!isNumber(value) || !entry.durations.includes(value)) {
      throw invalid(`Vertex ${model} duration must be one of: ${entry.durations.join(", ")} seconds`);
    }
  });
  if (body.negative_prompt !== undefined && body.negative_prompt !== null && !isString(body.negative_prompt)) {
    throw invalid("Vertex Veo negative_prompt must be a string");
  }

  const parameters = { sampleCount: 1 };
  if (aspectRatio) parameters.aspectRatio = aspectRatio;
  if (durationSeconds !== undefined) parameters.durationSeconds = durationSeconds;
  if (isString(body.negative_prompt) && body.negative_prompt) parameters.negativePrompt = body.negative_prompt;
  return { instances: [{ prompt: body.prompt }], parameters };
}
