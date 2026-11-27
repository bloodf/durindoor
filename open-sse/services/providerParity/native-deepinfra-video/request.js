// Request builder for the staged DeepInfra video adapter. The source sends
// `{ prompt, negative_prompt?, image?, seed? }` (image taken from `image` or
// `image_url`) and silently drops every other field, a non-string prompt
// (stringified), a non-number seed and a non-string image. Here each of those
// is refused with a 400 before anything is sent.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { DEEPINFRA_VIDEO_MODELS, deepinfraVideoModel } from "./config.js";

const MAX_PROMPT_CHARS = 8_000;
const MAX_IMAGE_URL_CHARS = 4_096;
const MAX_IMAGE_DATA_CHARS = 10 * 1024 * 1024;
const MAX_SEED = 2 ** 32 - 1;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
// Gateway fields the adapter reads itself; never forwarded.
const ALLOWED = new Set(["model", "prompt", "n", "response_format", "user", "stream", "negative_prompt", "image", "image_url", "seed"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value !== undefined && value !== null;

function checkImage(value) {
  if (!isString(value) || !value) throw reject("DeepInfra video image must be an https URL or a base64 image data URL");
  if (value.startsWith("data:")) {
    if (value.length > MAX_IMAGE_DATA_CHARS || !DATA_IMAGE_RE.test(value)) {
      throw reject("DeepInfra video image data URL must be a base64 png, jpeg or webp image within 10 MiB");
    }
    return value;
  }
  let url;
  try {
    url = value.length <= MAX_IMAGE_URL_CHARS ? new URL(value) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) {
    throw reject("DeepInfra video image URL must be a public https URL");
  }
  return url.href;
}

/** The DeepInfra `/v1/inference/{model}` body for an OpenAI-style video request. */
export function buildDeepinfraVideoRequest(model, body) {
  const entry = deepinfraVideoModel(model);
  if (!entry) throw reject(`Unsupported DeepInfra video model: ${model}. Use one of: ${DEEPINFRA_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  if (!isRecord(body)) throw reject("DeepInfra video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("DeepInfra video generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`DeepInfra video prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (present(body.n) && body.n !== 1) throw reject("DeepInfra video generation returns one video per request (n=1)");
  if (body.stream) throw reject("DeepInfra video generation does not support streaming");
  if (present(body.response_format) && body.response_format !== "url") throw reject("DeepInfra video supports response_format url only");
  const unsupported = Object.keys(body).find((key) => !ALLOWED.has(key) && present(body[key]));
  if (unsupported) throw reject(`DeepInfra video generation does not support ${unsupported}`);

  const request = { prompt: body.prompt };
  if (present(body.negative_prompt)) {
    if (!isString(body.negative_prompt) || body.negative_prompt.length > MAX_PROMPT_CHARS) {
      throw reject(`DeepInfra video negative_prompt must be a string of at most ${MAX_PROMPT_CHARS} characters`);
    }
    if (body.negative_prompt) request.negative_prompt = body.negative_prompt;
  }
  if (present(body.image) && present(body.image_url) && body.image !== body.image_url) {
    throw reject("DeepInfra video image and image_url disagree; send one of them");
  }
  const image = body.image ?? body.image_url;
  if (present(image)) {
    if (!entry.acceptsImage) throw reject(`DeepInfra video model ${entry.id} takes a text prompt only`);
    request.image = checkImage(image);
  }
  if (present(body.seed)) {
    if (!Number.isSafeInteger(body.seed) || body.seed < 0 || body.seed > MAX_SEED) {
      throw reject(`DeepInfra video seed must be an integer from 0 to ${MAX_SEED}`);
    }
    request.seed = body.seed;
  }
  return request;
}
