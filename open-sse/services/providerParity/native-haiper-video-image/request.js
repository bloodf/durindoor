// Request builders for the staged Haiper adapters. The source sends only
// `{ prompt, aspect_ratio }` for images (aspect_ratio defaulting to 16:9) and
// the fixed `{ prompt, duration: 4, aspect_ratio: "16:9" }` for video, and
// silently drops every other field. Here any field the source would drop, and
// any value it would replace, is refused with a 400 before anything is sent.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  HAIPER_IMAGE_ASPECT_RATIOS, HAIPER_IMAGE_DEFAULT_ASPECT_RATIO, HAIPER_IMAGE_MODELS, HAIPER_VIDEO_ASPECT_RATIO,
  HAIPER_VIDEO_DURATION_SECONDS, HAIPER_VIDEO_MODELS, haiperImageModel, haiperVideoModel,
} from "./config.js";

const MAX_PROMPT_CHARS = 8_000;
// Gateway fields every adapter reads itself; never forwarded.
const COMMON_FIELDS = ["model", "prompt", "n", "response_format", "user", "stream"];
const IMAGE_FIELDS = new Set([...COMMON_FIELDS, "aspect_ratio", "size"]);
const VIDEO_FIELDS = new Set([...COMMON_FIELDS, "aspect_ratio", "duration", "seconds"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value !== undefined && value !== null;

function checkCommon(kind, body, allowed) {
  if (!isRecord(body)) throw reject(`Haiper ${kind} generation needs a JSON object`);
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject(`Haiper ${kind} generation needs a text prompt`);
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`Haiper ${kind} prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (present(body.n) && body.n !== 1) throw reject(`Haiper ${kind} generation returns one result per request (n=1)`);
  if (body.stream) throw reject(`Haiper ${kind} generation does not support streaming`);
  if (present(body.response_format) && body.response_format !== "url") throw reject(`Haiper ${kind} supports response_format url only`);
  const unsupported = Object.keys(body).find((key) => !allowed.has(key) && present(body[key]));
  if (unsupported) throw reject(`Haiper ${kind} generation does not support ${unsupported}`);
}

/**
 * The Haiper image body for an OpenAI-style request. `size` is accepted as an
 * alias of `aspect_ratio` only when it is one of the registry's ratios.
 */
export function buildHaiperImageRequest(model, body) {
  if (!haiperImageModel(model)) throw reject(`Unsupported Haiper image model: ${model}. Use one of: ${HAIPER_IMAGE_MODELS.map((m) => m.id).join(", ")}`);
  checkCommon("image", body, IMAGE_FIELDS);
  const ratios = HAIPER_IMAGE_ASPECT_RATIOS.join(", ");
  for (const field of ["aspect_ratio", "size"]) {
    if (present(body[field]) && !HAIPER_IMAGE_ASPECT_RATIOS.includes(body[field])) throw reject(`Haiper image ${field} must be one of: ${ratios}`);
  }
  if (present(body.aspect_ratio) && present(body.size) && body.aspect_ratio !== body.size) {
    throw reject("Haiper image size and aspect_ratio disagree; send one of them");
  }
  return { prompt: body.prompt, aspect_ratio: body.aspect_ratio ?? body.size ?? HAIPER_IMAGE_DEFAULT_ASPECT_RATIO };
}

const isFixedDuration = (value) => value === HAIPER_VIDEO_DURATION_SECONDS || value === String(HAIPER_VIDEO_DURATION_SECONDS);

/** The Haiper video body: the source's fixed 4 s, 16:9 job. Other values are refused. */
export function buildHaiperVideoRequest(model, body) {
  if (!haiperVideoModel(model)) throw reject(`Unsupported Haiper video model: ${model}. Use one of: ${HAIPER_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  checkCommon("video", body, VIDEO_FIELDS);
  for (const field of ["duration", "seconds"]) {
    if (present(body[field]) && !isFixedDuration(body[field])) throw reject(`Haiper video ${field} must be ${HAIPER_VIDEO_DURATION_SECONDS}`);
  }
  if (present(body.aspect_ratio) && body.aspect_ratio !== HAIPER_VIDEO_ASPECT_RATIO) throw reject(`Haiper video aspect_ratio must be ${HAIPER_VIDEO_ASPECT_RATIO}`);
  return { prompt: body.prompt, duration: HAIPER_VIDEO_DURATION_SECONDS, aspect_ratio: HAIPER_VIDEO_ASPECT_RATIO };
}
