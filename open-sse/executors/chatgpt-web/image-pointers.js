/** ChatGPT Web image asset pointer helpers shared by the SSE reader and the async wait. */
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";


// ChatGPT can announce a `file_upload` placeholder before the real image id.
// It is not downloadable, and accepting it would end the async image wait early.
const UPLOAD_PLACEHOLDER_POINTER_RE = /^(?:(?:file-service|sediment):\/\/)?file_upload/;


function isImagePointer(value) {
  return isString(value) && !UPLOAD_PLACEHOLDER_POINTER_RE.test(value);
}


/**
 * Pull image asset pointers out of a multimodal_text parts array.
 *
 * For text-only messages parts is `["text..."]` and this returns `[]`. For
 * `image_gen` tool output, parts looks like:
 *   [
 *     { content_type: "image_asset_pointer",
 *       asset_pointer: "file-service://file-abc..." or "sediment://..." }
 *   ]
 * We collect every asset_pointer seen so the caller can resolve them once
 * the stream terminates.
 */
function extractImagePointers(parts) {
  const out = [];
  for (const p of parts) {
    if (!p || !isObject(p)) continue;
    const obj = p;
    if (obj.content_type === "image_asset_pointer" && isImagePointer(obj.asset_pointer)) {
      out.push(obj.asset_pointer);
    }
  }
  return out;
}


function imagePointerEntry(pointer, messageId) {
  const entry = { pointer };
  if (messageId) entry.messageId = messageId;
  return entry;
}


export { isImagePointer, extractImagePointers, imagePointerEntry };
