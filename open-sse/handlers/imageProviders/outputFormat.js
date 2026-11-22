// Output container validation and byte-based format reporting for image adapters.
// Ported from OmniRoute #20219. The upstream model owns format support; a requested
// container is forwarded, never replaced by PNG.
import { isString } from "../../../src/shared/utils/typeChecks.js";

export const IMAGE_FORMATS = ["png", "jpeg", "webp", "gif", "svg"];
const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
const BACKGROUNDS = ["auto", "opaque", "transparent"];

const isInt = (v) => Number.isInteger(v);
const reject = (message) => Object.assign(new Error(message), { status: 400 });

function normalizeFormat(value) {
  if (value == null) return undefined;
  const format = isString(value) ? value.trim().toLowerCase() : value;
  return IMAGE_FORMATS.includes(format) ? format : null;
}

/** Validate output_format / animation controls for ordinary OpenAI-compatible image requests. Returns the options to forward; throws a 400-tagged error. */
export function prepareImageOutputOptions(body) {
  const format = normalizeFormat(body.output_format);
  if (format === null) throw reject(`output_format must be one of: ${IMAGE_FORMATS.join(", ")}`);
  const { frame_count: count, frame_duration_ms: duration, background } = body;
  if ((count != null && !(isInt(count) && count >= 2 && count <= 16)) ||
      (duration != null && !(isInt(duration) && duration >= 20)) ||
      (background != null && !BACKGROUNDS.includes(background))) {
    throw reject("Invalid image output format or animation options");
  }
  if ((count != null || duration != null) && format !== "gif") {
    throw reject("frame_count and frame_duration_ms require output_format=gif");
  }
  if (format === "gif" && ((body.stream != null && body.stream !== false) ||
      (body.partial_images != null && body.partial_images !== 0) || body.output_compression != null)) {
    throw reject("GIF output does not support streaming, partial images or output_compression");
  }
  const options = {};
  if (format) options.output_format = format;
  if (count != null) options.frame_count = count;
  if (duration != null) options.frame_duration_ms = duration;
  return options;
}

// Fal's published GPT Image 2.6 text-to-image schemas bound frames to 2-16 and 20-2000 ms.
const FAL_GPT_26 = /^openai\/gpt-image-2\.6\/(?:sunburst|flare)\/text-to-image$/;

/** Fal forwards the container and frame controls; other endpoints keep their own bounds (and upstream 4xx errors). */
export function prepareFalOutputOptions(body, endpoint) {
  const format = normalizeFormat(body.output_format);
  if (format === null) throw reject("Invalid fal image output format or animation options");
  const { frame_count: count, frame_duration_ms: duration } = body;
  const gpt26 = FAL_GPT_26.test(endpoint);
  const okCount = count == null || (isInt(count) && count > 0 && (!gpt26 || (count >= 2 && count <= 16)));
  const okDuration = duration == null || (isInt(duration) && duration > 0 && (!gpt26 || (duration >= 20 && duration <= 2000)));
  if (!okCount || !okDuration) {
    throw reject(gpt26
      ? "Invalid fal GPT Image 2.6 options: frame_count 2-16; frame_duration_ms 20-2000"
      : "Invalid fal image output format or animation options");
  }
  if (gpt26 && (count != null || duration != null) && format !== "gif") {
    throw reject("fal GPT Image 2.6 frame controls require output_format=gif");
  }
  const options = {};
  if (format) options.output_format = format;
  if (count != null) options.frame_count = count;
  if (duration != null) options.frame_duration_ms = duration;
  return options;
}

/** Stability only produces png/jpeg/webp stills; reject the rest before any inference. */
export function prepareStabilityOutputOptions(body) {
  const format = normalizeFormat(body.output_format) ?? "png";
  if (!["png", "jpeg", "webp"].includes(format)) {
    throw reject("Stability AI output_format must be one of: png, jpeg, webp");
  }
  if (body.frame_count != null || body.frame_duration_ms != null) {
    throw reject("Stability AI does not support animated image frame controls");
  }
  return { output_format: format };
}

function skipXmlProlog(prefix) {
  let text = prefix.trimStart();
  while (text.startsWith("<!--") || text.startsWith("<?")) {
    const terminator = text.startsWith("<!--") ? "-->" : "?>";
    const end = text.indexOf(terminator);
    if (end === -1) break;
    text = text.slice(end + terminator.length).trimStart();
  }
  return text;
}

/** Detect the container from a bounded base64 prefix; never decodes the whole image. */
export function sniffImageFormat(base64) {
  if (!isString(base64)) return undefined;
  const bytes = Buffer.from(base64.slice(0, 2048), "base64");
  const header = bytes.toString("latin1", 0, 12);
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "gif";
  if (header.startsWith("\x89PNG\r\n\x1a\n")) return "png";
  if (header.startsWith("\xff\xd8\xff")) return "jpeg";
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "webp";
  if (/^<svg(?:\s|>)/.test(skipXmlProlog(bytes.toString("utf8")))) return "svg";
  return undefined;
}

/** Report the real container: per-item `mime_type` and a top-level `output_format` when all items agree. URL items are untouched. */
export function normalizeImageOutput(body, requestedFormat, warn) {
  if (!body || !Array.isArray(body.data)) return body;
  const declared = normalizeFormat(body.output_format) || undefined;
  const formats = new Set();
  let allKnown = body.data.length > 0;
  const data = body.data.map((item) => {
    const detected = item && isString(item.b64_json) ? sniffImageFormat(item.b64_json) : undefined;
    const format = detected ?? declared;
    if (!format) allKnown = false;
    else {
      formats.add(format);
      if (isString(requestedFormat) && format !== requestedFormat.trim().toLowerCase()) {
        warn?.("IMAGE", `Image output format mismatch: requested ${requestedFormat}, received ${format}`);
      }
    }
    return detected ? { ...item, mime_type: MIME[detected] } : item;
  });
  const output_format = allKnown && formats.size === 1 ? [...formats][0] : undefined;
  const result = { ...body, data };
  if (output_format) result.output_format = output_format;
  return result;
}
