// SYNTX image-part helpers. Port of OmniRoute c71f0065
// open-sse/executors/syntxChat.ts (collectSyntxImageSources, decodeDataUrl).
// The executor bounds how many sources it uploads per turn.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";

const asRecord = (value) => (isRecord(value) ? value : {});
const str = (value) => (isString(value) ? value : "");
const DATA_IMAGE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;

/** Whether `url` is an inline base64 image data URL. */
export const isDataImageUrl = (url) => isString(url) && url.slice(0, 11).toLowerCase() === "data:image/";

function imageUrlFromPart(rec) {
  const type = str(rec.type).toLowerCase();
  if (type === "image_url" || type === "input_image") return str(rec.url) || str(asRecord(rec.image_url).url) || str(rec.image);
  if (isString(rec.image_url)) return rec.image_url;
  return "";
}

/** Source collectSyntxImageSources. */
export function collectSyntxImageSources(content) {
  const out = [];
  if (isString(content)) {
    for (const dataUrl of content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g) || []) out.push({ url: dataUrl });
    return out;
  }
  if (!Array.isArray(content)) return out;
  for (const part of content) {
    if (!isRecord(part)) continue;
    const url = imageUrlFromPart(part).trim();
    if (url) out.push({ url });
  }
  return out;
}

/** Source decodeDataUrl (images only). */
export function decodeDataUrl(dataUrl) {
  const match = String(dataUrl).match(DATA_IMAGE);
  if (!match) return null;
  const mime = match[1];
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return { bytes: Uint8Array.from(Buffer.from(match[2], "base64")), mime, name: `image.${ext}` };
}
