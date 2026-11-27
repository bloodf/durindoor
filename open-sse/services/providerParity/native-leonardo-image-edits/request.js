// Parse an OpenAI-style /v1/images/edits request into the subset Leonardo's
// init-image flow can honor. Everything runs before any network call: a mask,
// more than one reference, a remote or file-id reference, an unknown field or
// an image that is not PNG/JPEG/WebP by its bytes is refused here.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { sniffImageFormat } from "../../../utils/imageSniff.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  resolveLeonardoImageModelId, resolveLeonardoImageSize,
} from "../native-leonardo-video-image/image.js";
import {
  LEONARDO_EDIT_DECLARED_MIMES, LEONARDO_EDIT_FORMATS, LEONARDO_EDIT_MAX_IMAGE_BYTES, LEONARDO_EDIT_MIN_IMAGE_BYTES,
} from "./config.js";

const MAX_PROMPT_CHARS = 32_000;
const IMAGE_FIELDS = new Set(["image", "image[]", "images", "images[]"]);
const MASK_FIELDS = new Set(["mask", "mask[]"]);
// Text fields this subset maps or ignores (`user` is a gateway field and is not sent).
const TEXT_FIELDS = new Set(["model", "prompt", "size", "n", "response_format", "user", "stream"]);
const DATA_URI_RE = /^data:([a-z]+\/[a-z0-9.+-]+)(?:;[a-z0-9-]+=[^;,]*)*;base64,([A-Za-z0-9+/\s]*={0,2})$/i;
// Base64 length that still decodes to at most the byte bound.
const MAX_BASE64_CHARS = Math.ceil(LEONARDO_EDIT_MAX_IMAGE_BYTES / 3) * 4 + 1024;

export const rejectEdit = (message, status = HTTP_STATUS.BAD_REQUEST) => Object.assign(new Error(message), { status });

/**
 * The reference bytes as one of PNG/JPEG/WebP. The declared type, when
 * present and specific, must agree with the bytes; the sniffed type is sent.
 */
export function checkLeonardoEditImage(bytes, declaredMime) {
  if (bytes.byteLength < LEONARDO_EDIT_MIN_IMAGE_BYTES) throw rejectEdit("Leonardo image edit reference image is empty or truncated");
  if (bytes.byteLength > LEONARDO_EDIT_MAX_IMAGE_BYTES) {
    throw rejectEdit(`Leonardo image edit reference image must not exceed ${LEONARDO_EDIT_MAX_IMAGE_BYTES} bytes`, HTTP_STATUS.PAYLOAD_TOO_LARGE);
  }
  const sniffed = sniffImageFormat(bytes);
  // JPEG needs its full SOI + marker prefix, not just FF D8.
  const jpegOk = sniffed !== "jpeg" || bytes[2] === 0xff;
  const format = jpegOk ? LEONARDO_EDIT_FORMATS[sniffed] : undefined;
  if (!format) throw rejectEdit("Leonardo image edits accept one PNG, JPEG or WebP reference image");
  const declared = isString(declaredMime) ? declaredMime.split(";")[0].trim().toLowerCase() : "";
  if (declared && declared !== "application/octet-stream" && LEONARDO_EDIT_DECLARED_MIMES[declared] !== sniffed) {
    throw rejectEdit("Leonardo image edit reference image type does not match its content");
  }
  return { bytes, sniffed, mime: format.mime, extension: format.extension };
}

function decodeDataUri(value) {
  if (value.length > MAX_BASE64_CHARS) {
    throw rejectEdit(`Leonardo image edit reference image must not exceed ${LEONARDO_EDIT_MAX_IMAGE_BYTES} bytes`, HTTP_STATUS.PAYLOAD_TOO_LARGE);
  }
  const match = DATA_URI_RE.exec(value.trim());
  if (!match) throw rejectEdit("Leonardo image edits accept an uploaded file or a base64 data: URI reference only");
  const payload = match[2].replace(/\s+/g, "");
  if (payload.length % 4 === 1) throw rejectEdit("Leonardo image edit reference image is not valid base64");
  return checkLeonardoEditImage(new Uint8Array(Buffer.from(payload, "base64")), match[1]);
}

function jsonReference(value) {
  if (isString(value)) {
    if (/^data:/i.test(value.trim())) return decodeDataUri(value);
    throw rejectEdit("Leonardo image edits do not fetch remote reference URLs; upload the file or send a data: URI");
  }
  if (isRecord(value)) {
    if (value.file_id !== undefined) throw rejectEdit("Leonardo image edits do not support file_id references");
    const extra = Object.keys(value).find((key) => key !== "url" && key !== "type");
    if (extra || (value.type !== undefined && value.type !== "image_url") || !isString(value.url)) {
      throw rejectEdit("Leonardo image edit reference must be a data: URI or { url: data: URI }");
    }
    return jsonReference(value.url);
  }
  throw rejectEdit("Leonardo image edit reference must be a data: URI or { url: data: URI }");
}

function textOf(value, field) {
  if (value === undefined || value === null) return undefined;
  if (!isString(value)) throw rejectEdit(`Leonardo image edit field ${field} must be text`);
  return value;
}

function checkCommon(fields) {
  const prompt = fields.prompt;
  if (!isString(prompt) || !prompt.trim()) throw rejectEdit("Leonardo image edits need a text prompt");
  if (prompt.length > MAX_PROMPT_CHARS) throw rejectEdit(`Leonardo image edit prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  const n = fields.n;
  if (n !== undefined && n !== null && n !== 1 && n !== "1") throw rejectEdit("Leonardo image edits return one image per request (n=1)");
  const stream = fields.stream;
  if (stream !== undefined && stream !== null && stream !== false && stream !== "false") {
    throw rejectEdit("Leonardo image edits do not support streaming");
  }
  const format = fields.response_format ?? "url";
  if (format !== "url") throw rejectEdit("Leonardo image edits support response_format url only");
}

/** Fields from a multipart form. Exactly one image Blob; masks and other files refused. */
async function fromForm(formData) {
  const fields = {};
  const images = [];
  for (const [key, value] of formData.entries()) {
    if (MASK_FIELDS.has(key)) throw rejectEdit("Leonardo image edits do not support masks");
    if (IMAGE_FIELDS.has(key)) {
      images.push(value);
      continue;
    }
    if (!TEXT_FIELDS.has(key)) throw rejectEdit(`Leonardo image edits do not support ${key}`);
    if (value instanceof Blob) throw rejectEdit(`Leonardo image edit field ${key} must be text`);
    if (key in fields) throw rejectEdit(`Leonardo image edit field ${key} was sent more than once`);
    fields[key] = value;
  }
  if (images.length !== 1) throw rejectEdit("Leonardo image edits accept exactly one reference image");
  const [image] = images;
  let reference;
  if (image instanceof Blob) {
    if (image.size > LEONARDO_EDIT_MAX_IMAGE_BYTES) {
      throw rejectEdit(`Leonardo image edit reference image must not exceed ${LEONARDO_EDIT_MAX_IMAGE_BYTES} bytes`, HTTP_STATUS.PAYLOAD_TOO_LARGE);
    }
    reference = checkLeonardoEditImage(new Uint8Array(await image.arrayBuffer()), image.type);
  } else {
    reference = jsonReference(image);
  }
  return { fields, reference };
}

/** Fields from a JSON body: `image` (one source) or `images` (a one-element array). */
function fromJson(body) {
  if (!isRecord(body)) throw rejectEdit("Leonardo image edit needs a JSON object");
  for (const key of Object.keys(body)) {
    if (body[key] === undefined || body[key] === null) continue;
    if (MASK_FIELDS.has(key)) throw rejectEdit("Leonardo image edits do not support masks");
    if (key !== "image" && key !== "images" && !TEXT_FIELDS.has(key)) throw rejectEdit(`Leonardo image edits do not support ${key}`);
  }
  const hasImage = body.image !== undefined && body.image !== null;
  const hasImages = body.images !== undefined && body.images !== null;
  if (hasImage === hasImages) throw rejectEdit("Leonardo image edits accept exactly one reference image");
  const sources = hasImages ? body.images : [body.image];
  if (!Array.isArray(sources) || sources.length !== 1 || Array.isArray(sources[0])) {
    throw rejectEdit("Leonardo image edits accept exactly one reference image");
  }
  return { fields: body, reference: jsonReference(sources[0]) };
}

/**
 * Validate an edit request and build the generation fields. Throws an error
 * with `status` (400/413) for anything this subset cannot honor.
 *
 * @returns {{ generation: { modelId, prompt, width, height, num_images: 1 }, reference: { bytes, mime, extension } }}
 */
export async function parseLeonardoEditRequest({ model, formData = null, jsonBody = null }) {
  if (!formData === !jsonBody) throw rejectEdit("Leonardo image edit needs either a multipart form or a JSON body");
  const { fields, reference } = jsonBody ? fromJson(jsonBody) : await fromForm(formData);
  checkCommon(fields);
  const modelId = resolveLeonardoImageModelId(model);
  // The source edit branch forwards only `{ prompt, size }`: width/height are not edit fields.
  const size = textOf(fields.size, "size");
  const { width, height } = resolveLeonardoImageSize({ size });
  return {
    generation: { modelId, prompt: fields.prompt, width, height, num_images: 1 },
    reference,
  };
}
