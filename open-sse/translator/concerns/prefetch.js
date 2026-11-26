// Pre-fetch remote image URLs into base64 BEFORE translation, for target
// formats whose upstream providers cannot fetch remote URLs themselves
// (they require inline base64). Runs on the source-format body.
import { FORMATS } from "../formats.js";
import { fetchImageAsBase64, parseDataUri } from "./image.js";
import { MAX_IMAGE_BYTES } from "../../config/mediaConfig.js";

// Targets that require inline base64 images (cannot accept remote URLs).
import { isString } from "../../../src/shared/utils/typeChecks.js";
const TARGETS_NEED_BASE64 = new Set([
FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX,
FORMATS.ANTIGRAVITY, FORMATS.OLLAMA, FORMATS.KIRO,
FORMATS.COMMANDCODE]
);
const MAX_IMAGES_PER_REQUEST = 10;

function isRemoteUrl(url) {
  return isString(url) && (url.startsWith("http://") || url.startsWith("https://"));
}

// Collect {get,set} accessors for every remote image URL in a source body.
function collectImageRefs(body, sourceFormat) {
  const refs = [];
  const pushOpenAI = (messages) => {
    for (const msg of messages || []) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block?.type === "image_url") {
          const url = isString(block.image_url) ? block.image_url : block.image_url?.url;
          if (isRemoteUrl(url)) refs.push({ get: () => url, set: (v) => {
              if (isString(block.image_url)) block.image_url = v;else block.image_url.url = v;
            } });
        }
      }
    }
  };
  // Responses carries images in message content and in tool-output arrays.
  const pushResponses = (input) => {
    for (const item of Array.isArray(input) ? input : []) {
      for (const parts of [item?.content, item?.output]) {
        for (const part of Array.isArray(parts) ? parts : []) {
          if (part?.type !== "input_image") continue;
          const url = isString(part.image_url) ? part.image_url : part.image_url?.url;
          if (isRemoteUrl(url)) refs.push({ get: () => url, set: (v) => {
              if (isString(part.image_url)) part.image_url = v;else part.image_url.url = v;
            } });
        }
      }
    }
  };
  const pushGemini = (contents) => {
    for (const c of contents || []) {
      for (const p of c.parts || []) {
        const uri = p?.fileData?.fileUri;
        if (isRemoteUrl(uri)) refs.push({ get: () => uri, part: p });
      }
    }
  };

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      pushOpenAI(body.messages);
      break;
    case FORMATS.CLAUDE:
      for (const msg of body.messages || []) {
        if (!Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
          if (block?.type === "image" && block.source?.type === "url" && isRemoteUrl(block.source.url)) {
            refs.push({ get: () => block.source.url, claudeBlock: block });
          }
        }
      }
      break;
    case FORMATS.OPENAI_RESPONSES:
      pushOpenAI(body.messages);
      pushResponses(body.input);
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      pushGemini(body.contents);
      break;
    case FORMATS.ANTIGRAVITY:
      pushGemini(body?.request?.contents);
      break;
    default:
      pushOpenAI(body.messages);
  }
  return refs;
}

/**
 * One request's image allowance: at most MAX_IMAGES_PER_REQUEST fetch attempts
 * and MAX_IMAGE_BYTES of fetched data. Await each call before starting the next.
 * Resolves null, without fetching, once the allowance is spent or the signal aborts.
 *
 * @param {object} options - fetchImageAsBase64 options
 * @returns {(url: string) => Promise<{url: string, mimeType: string}|null>}
 */
export function createBudgetedImageFetcher(options = {}) {
  let attempted = 0;
  let totalBytes = 0;
  return async (url) => {
    const remainingBytes = MAX_IMAGE_BYTES - totalBytes;
    if (attempted >= MAX_IMAGES_PER_REQUEST || remainingBytes <= 0 || options.signal?.aborted) return null;
    attempted++;
    const configuredMaxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
    const fetchOptions = totalBytes === 0 && configuredMaxBytes <= MAX_IMAGE_BYTES ? options : {
      ...options,
      maxBytes: Math.min(configuredMaxBytes, remainingBytes),
    };
    const fetched = await fetchImageAsBase64(url, fetchOptions);
    if (!fetched) return null;
    const payload = fetched.url.split(",")[1] || "";
    const imageBytes = Math.max(0, Math.floor(payload.length * 3 / 4) -
      (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0));
    if (totalBytes + imageBytes > MAX_IMAGE_BYTES) return null;
    totalBytes += imageBytes;
    return fetched;
  };
}

/**
 * Replace remote image URLs with base64 data when the target needs inline data.
 * No-op when target accepts remote URLs (e.g. openai, claude) or body has none.
 * @returns {Promise<number>} count of images converted
 */
export async function prefetchRemoteImages(body, sourceFormat, targetFormat, options = {}) {
  if (!body || !TARGETS_NEED_BASE64.has(targetFormat)) return 0;
  const refs = collectImageRefs(body, sourceFormat);
  if (!refs.length) return 0;

  let converted = 0;
  const fetchImage = createBudgetedImageFetcher(options);
  for (const ref of refs) {
    const url = ref.get();
    if (parseDataUri(url)) continue; // already inline
    const fetched = await fetchImage(url);
    if (!fetched) continue;
    if (ref.set) ref.set(fetched.url);else
    if (ref.part) {delete ref.part.fileData;ref.part.inlineData = { mimeType: fetched.mimeType, data: fetched.url.split(",")[1] };} else
    if (ref.claudeBlock) ref.claudeBlock.source = { type: "base64", media_type: fetched.mimeType, data: fetched.url.split(",")[1] };
    converted++;
  }
  return converted;
}
