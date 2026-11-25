import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

function imageUrl(part) {
  return isString(part.image_url) ? part.image_url : part.image_url?.url;
}

/** Normalize legacy images only in Responses message content and function outputs. */
export function normalizeResponsesImageReplay(input) {
  if (!Array.isArray(input)) return input;
  return input.map((item) => {
    if (!item || !isObject(item)) return item;
    const message = (!item.type || item.type === RESPONSES_ITEM.MESSAGE) && (item.role === ROLE.USER || item.role === ROLE.ASSISTANT);
    const toolOutput = item.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT;
    const field = message ? "content" : toolOutput ? "output" : null;
    if (!field || !Array.isArray(item[field])) return item;
    return { ...item, [field]: item[field].map((part) => {
      if (!part || !isObject(part)) return part;
      if (message && item.role === ROLE.ASSISTANT && (part.type === OPENAI_BLOCK.IMAGE_URL || part.type === RESPONSES_ITEM.INPUT_IMAGE)) {
        const url = imageUrl(part);
        return { type: RESPONSES_ITEM.OUTPUT_TEXT, text: isString(url) && url ? `[Image: ${url}]` : "[Image]" };
      }
      if (part.type !== OPENAI_BLOCK.IMAGE_URL) return part;
      const url = imageUrl(part);
      if (!isString(url) || !url) return part;
      const detail = part.image_url?.detail ?? part.detail;
      const image = { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: url };
      if (["auto", "low", "high"].includes(detail)) image.detail = detail;
      return image;
    }) };
  });
}
