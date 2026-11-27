// fal.ai ACE-Step request body. Everything the adapter cannot send is refused
// here, before any credential is used or anything billable is submitted.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/mediaGeneration/fal.ts (buildFalMusicRequestBody: `tags`
// from `tags` or `prompt`, `lyrics`, `duration`, `seed`, the guidance and step
// numbers, `scheduler` euler|heun, `guidance_type` cfg|apg|cfg_star; and
// handleFalMusicGeneration: a request with `fal_input` goes through schema
// discovery instead of the built-in body) and
// open-sse/handlers/fal/schema.ts (falCompatibilityInput: envelope fields are
// dropped, the OpenAI-style optional controls are forwarded only when the
// endpoint documents them, `fal_input` is merged last).
//
// Fork deviations: the source sends an empty `tags` string, clamps a duration
// to 5..240 and silently drops an unknown scheduler, guidance type or a
// non-number control; here each of those is refused, so the caller is never
// billed for something other than what was asked. Media inputs, `n` other than
// 1, `stream`, and response formats other than `url` are refused too, because
// the source path never forwards or honors them.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FAL_MUSIC_MODEL_IDS, FAL_MUSIC_RESPONSE_FORMATS, falMusicModel } from "./config.js";

export const FAL_MUSIC_MIN_SECONDS = 5;
export const FAL_MUSIC_MAX_SECONDS = 240;

// Source buildFalMusicRequestBody optional numeric controls, in source order.
export const FAL_MUSIC_NUMBER_FIELDS = Object.freeze([
  "number_of_steps",
  "granularity_scale",
  "guidance_interval",
  "guidance_interval_decay",
  "tag_guidance_scale",
  "lyric_guidance_scale",
  "minimum_guidance_scale",
  "guidance_scale",
]);
const SCHEDULERS = Object.freeze(["euler", "heun"]);
const GUIDANCE_TYPES = Object.freeze(["cfg", "apg", "cfg_star"]);

// Media inputs the built-in body never forwards (audio-to-audio, edits, references).
const MEDIA_FIELDS = Object.freeze([
  "audio", "audio_url", "audioUrl", "audio_urls", "reference_audio", "reference_audio_url", "reference_audio_urls",
  "image", "image_url", "image_urls", "images", "mask", "video", "video_url", "video_urls", "input_reference", "media", "content",
]);
// Source falCompatibilityInput envelope: never part of the fal input.
const ENVELOPE = new Set(["model", "response_format", "fal_input", "n", "stream", "size"]);
// Source FAL_OPTIONAL_CONTROLS: forwarded only when the endpoint documents them.
const OPTIONAL_CONTROLS = new Set(["quality", "style", "user", "stream", "sync_mode"]);

const invalid = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const text = (value) => (isString(value) && value.trim() ? value.trim() : undefined);
const present = (body, name) => body[name] !== undefined && body[name] !== null;

/**
 * Checks shared by the built-in body and the `fal_input` path.
 *
 * @returns {{ endpoint: string, model: string }}
 * @throws {Error} with `status` 400
 */
export function checkFalMusicEnvelope(model, body) {
  const entry = falMusicModel(model);
  if (!entry) throw invalid(`Unsupported fal music model: ${model}. Supported: ${FAL_MUSIC_MODEL_IDS.join(", ")}`);
  if (!isRecord(body)) throw invalid("fal music request body must be a JSON object");
  if (body.stream !== undefined && body.stream !== false) throw invalid("fal music generation does not stream");
  if (present(body, "n") && body.n !== 1) throw invalid("fal music generates one track per request; n must be 1");
  if (present(body, "response_format") && !FAL_MUSIC_RESPONSE_FORMATS.includes(body.response_format)) {
    throw invalid(`fal music response_format must be one of: ${FAL_MUSIC_RESPONSE_FORMATS.join(", ")}`);
  }
  const media = MEDIA_FIELDS.filter((name) => present(body, name));
  if (media.length) throw invalid(`fal ${entry.id} is text-to-music only; remove ${media.join(", ")}`);
  if (present(body, "size")) throw invalid("fal music does not take size");
  for (const name of ["instrumental", "make_instrumental"]) {
    if (present(body, name) && body[name] !== false) {
      throw invalid(`fal ${entry.id} has no ${name} switch; send lyrics "[inst]" or omit lyrics instead`);
    }
  }
  if (present(body, "fal_input") && !isRecord(body.fal_input)) throw invalid("fal_input must be a JSON object");
  return { endpoint: entry.endpoint, model: entry.id };
}

/**
 * The built-in ACE-Step body (source buildFalMusicRequestBody), with refusals
 * in place of the source's silent drops and clamps.
 *
 * @param {string} model - `ace-step` or `fal-ai/ace-step`
 * @param {object} body - the public request body
 * @returns {object} the queue submit body
 * @throws {Error} with `status` 400 for anything that cannot be sent
 */
export function buildFalMusicRequest(model, body) {
  checkFalMusicEnvelope(model, body);
  if (present(body, "fal_input")) throw invalid("fal_input requires schema discovery; use prepareFalMusicInput");
  for (const name of ["tags", "prompt", "lyrics", "scheduler", "guidance_type"]) {
    if (present(body, name) && !isString(body[name])) throw invalid(`fal music ${name} must be a string`);
  }
  const tags = text(body.tags) || text(body.prompt);
  if (!tags) throw invalid("fal music requires a nonempty prompt or tags");
  if (text(body.tags) && text(body.prompt) && text(body.tags) !== text(body.prompt)) {
    throw invalid("fal music takes one style description: prompt and tags disagree");
  }
  const request = { tags };

  const lyrics = text(body.lyrics);
  if (lyrics) request.lyrics = lyrics;

  if (present(body, "duration")) {
    const duration = body.duration;
    if (!isNumber(duration) || !Number.isFinite(duration) || duration < FAL_MUSIC_MIN_SECONDS || duration > FAL_MUSIC_MAX_SECONDS) {
      throw invalid(`fal music duration must be a number from ${FAL_MUSIC_MIN_SECONDS} to ${FAL_MUSIC_MAX_SECONDS} seconds`);
    }
    request.duration = duration;
  }
  if (present(body, "seed")) {
    if (!Number.isInteger(body.seed)) throw invalid("fal music seed must be an integer");
    request.seed = body.seed;
  }
  for (const field of FAL_MUSIC_NUMBER_FIELDS) {
    if (!present(body, field)) continue;
    if (!isNumber(body[field]) || !Number.isFinite(body[field])) throw invalid(`fal music ${field} must be a number`);
    request[field] = body[field];
  }
  if (present(body, "scheduler")) {
    if (!SCHEDULERS.includes(body.scheduler)) throw invalid(`fal music scheduler must be one of: ${SCHEDULERS.join(", ")}`);
    request.scheduler = body.scheduler;
  }
  if (present(body, "guidance_type")) {
    if (!GUIDANCE_TYPES.includes(body.guidance_type)) throw invalid(`fal music guidance_type must be one of: ${GUIDANCE_TYPES.join(", ")}`);
    request.guidance_type = body.guidance_type;
  }
  return request;
}

/**
 * The source compatibility input for a request with `fal_input`: public fields
 * the endpoint documents (and any not in the optional-control list), then
 * `fal_input` on top. Validation against the discovered schema happens in
 * ./discovery.js.
 */
export function falMusicCompatibilityInput(body, properties) {
  const input = {};
  for (const [key, value] of Object.entries(body)) {
    if (ENVELOPE.has(key)) continue;
    if (Object.hasOwn(properties, key) || !OPTIONAL_CONTROLS.has(key)) input[key] = value;
  }
  // `prompt` is this route's name for ACE-Step's `tags`; the source mapped it only in the built-in body.
  if (input.prompt !== undefined && !Object.hasOwn(properties, "prompt") && Object.hasOwn(properties, "tags")) {
    if (input.tags === undefined) input.tags = input.prompt;
    delete input.prompt;
  }
  for (const name of ["instrumental", "make_instrumental"]) {
    if (isBoolean(input[name]) && input[name] === false && !Object.hasOwn(properties, name)) delete input[name];
  }
  return { ...input, ...body.fal_input };
}
