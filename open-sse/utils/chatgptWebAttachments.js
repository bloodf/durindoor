import {
  MAX_IMAGE_DECODE_EDGE,
  MAX_IMAGE_PIXELS,
  sniffImageDimensions,
  sniffImageFormat,
} from "./imageSniff.js";
import { guardedProbeFetch } from "./outboundUrlGuard.js";
import { detectMediaParts } from "./mediaParts.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

export const MAX_CHATGPT_WEB_ATTACHMENTS = 10;
export const MAX_CHATGPT_WEB_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_CHATGPT_WEB_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_CHATGPT_WEB_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const REMOTE_FETCH_TIMEOUT_MS = 20_000;
const MAX_REMOTE_REDIRECTS = 3;
const MAX_FILENAME_CHARS = 180;

const IMAGE_EXTENSIONS = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class ChatGptWebAttachmentError extends Error {
  status = 400;

  constructor(message) {
    super(message);
    this.name = "ChatGptWebAttachmentError";
  }
}

function isRecord(value) {
  return isObject(value) && value !== null && !Array.isArray(value);
}

function optionalString(value) {
  return isString(value) && value.trim() ? value.trim() : undefined;
}

function sanitizeFilename(value, fallback) {
  const leaf = (value ?? "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const safe = leaf || fallback;
  return safe.slice(0, MAX_FILENAME_CHARS);
}

function mimeFromDataUrl(ref) {
  const match = /^data:([^;,]+);base64,/i.exec(ref);
  return match?.[1]?.trim().toLowerCase();
}

function extensionForImageRef(ref) {
  const mime = mimeFromDataUrl(ref);
  if (mime && IMAGE_EXTENSIONS[mime]) return IMAGE_EXTENSIONS[mime];
  try {
    const match = /\.([a-zA-Z0-9]{2,5})$/.exec(new URL(ref).pathname);
    if (match && ["gif", "jpeg", "jpg", "png", "webp"].includes(match[1].toLowerCase())) {
      return match[1].toLowerCase().replace("jpeg", "jpg");
    }
  } catch {
    // Data URLs and malformed URLs fall back to PNG; resolution validates the source later.
  }
  return "png";
}

function filePayload(part) {
  return isRecord(part.file) ? part.file : part;
}

function fileSourceFromPart(part) {
  const file = filePayload(part);
  const fileData = optionalString(file.file_data ?? part.file_data);
  const fileUrl = optionalString(file.file_url ?? part.file_url ?? file.url ?? part.url);
  const mimeType = optionalString(file.mime_type ?? part.mime_type)?.toLowerCase();
  let ref = fileData ?? fileUrl;
  if (!ref) {
    throw new ChatGptWebAttachmentError("ChatGPT Web file input requires file_data or file_url");
  }
  if (fileData && !fileData.toLowerCase().startsWith("data:")) {
    ref = `data:${mimeType ?? "application/octet-stream"};base64,${fileData}`;
  }
  const source = {
    kind: "file",
    ref,
    name: sanitizeFilename(optionalString(file.filename ?? part.filename), "attachment.bin"),
  };
  if (mimeType) source.mimeType = mimeType;
  return source;
}

export function isChatGptWebAttachmentContentPart(value) {
  if (isString(value)) return value.toLowerCase().startsWith("data:image/");
  if (!isRecord(value)) return false;
  const type = optionalString(value.type)?.toLowerCase();
  return ["file", "image", "image_url", "input_file", "input_image"].includes(type ?? "");
}

function extractImageAttachmentSources(messages) {
  const sources = [];
  const imageParts = detectMediaParts(messages)
    .filter((part) => part.kind === "image" && !part.nested)
    .sort(
      (left, right) => left.messageIndex - right.messageIndex || left.partIndex - right.partIndex
    );

  for (const image of imageParts) {
    if (!image.ref) {
      throw new ChatGptWebAttachmentError("ChatGPT Web image input is missing a URL or data");
    }
    const part = messages[image.messageIndex]?.content?.[image.partIndex];
    const record = isRecord(part) ? part : null;
    const explicitName = optionalString(record?.filename ?? record?.name);
    const index = sources.length + 1;
    const mimeType = mimeFromDataUrl(image.ref);
    const source = {
      kind: "image",
      ref: image.ref,
      name: sanitizeFilename(explicitName, `image-${index}.${extensionForImageRef(image.ref)}`),
    };
    if (mimeType) source.mimeType = mimeType;
    sources.push(source);
  }
  return sources;
}

function extractFileAttachmentSources(messages) {
  const sources = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!isRecord(part)) continue;
      const type = optionalString(part.type)?.toLowerCase();
      if (type === "file" || type === "input_file") sources.push(fileSourceFromPart(part));
    }
  }
  return sources;
}

export function extractChatGptWebAttachmentSources(messages) {
  const sources = [
    ...extractImageAttachmentSources(messages),
    ...extractFileAttachmentSources(messages),
  ];
  if (sources.length > MAX_CHATGPT_WEB_ATTACHMENTS) {
    throw new ChatGptWebAttachmentError(
      `ChatGPT Web accepts at most ${MAX_CHATGPT_WEB_ATTACHMENTS} attachments per request`
    );
  }
  return sources;
}

function decodeDataUrl(ref) {
  const comma = ref.indexOf(",");
  if (comma < 0) throw new ChatGptWebAttachmentError("Attachment data URL is malformed");
  const header = ref.slice(5, comma);
  if (!/(?:^|;)base64(?:;|$)/i.test(header)) {
    throw new ChatGptWebAttachmentError("Attachment data URL must be base64 encoded");
  }
  const mimeType = (header.split(";")[0] || "application/octet-stream").toLowerCase();
  const raw = ref.slice(comma + 1);
  if (raw.length > MAX_CHATGPT_WEB_FILE_BYTES * 2) {
    throw new ChatGptWebAttachmentError("Attachment is too large");
  }
  const normalized = raw.replace(/\s/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new ChatGptWebAttachmentError("Attachment contains invalid base64 data");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (
    !bytes.length ||
    bytes.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")
  ) {
    throw new ChatGptWebAttachmentError("Attachment contains invalid base64 data");
  }
  return { bytes, mimeType };
}

/**
 * Fetch a remote attachment through the outbound URL guard: private and
 * metadata addresses are refused at connect time, every redirect hop is
 * re-checked, and the body is capped at `maxBytes` while it streams.
 * Error messages match what fetchRemoteAttachment classifies.
 */
export async function fetchRemoteMedia(url, { maxBytes, maxRedirects, timeoutMs }, fetcher = fetch) {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await guardedProbeFetch(current, { method: "GET", signal }, "public-only", fetcher);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hop === maxRedirects) throw new Error("Remote media redirect refused");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Remote media fetch error ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error("Remote media exceeds byte limit");
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body ?? []) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error("Remote media exceeds byte limit");
      chunks.push(chunk);
    }
    return {
      buffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
      contentType: response.headers.get("content-type") || "",
    };
  }
  throw new Error("Remote media redirect refused");
}

async function fetchRemoteAttachment(ref, maxBytes, fetchMedia) {
  try {
    const remote = await fetchMedia(ref, {
      guard: "public-only",
      pinDns: true,
      maxBytes,
      maxRedirects: MAX_REMOTE_REDIRECTS,
      timeoutMs: REMOTE_FETCH_TIMEOUT_MS,
    });
    return {
      bytes: remote.buffer,
      mimeType:
        remote.contentType.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/exceeds? .*byte limit/i.test(message)) {
      throw new ChatGptWebAttachmentError("Attachment is too large");
    }
    const status = /fetch error (\d{3})/i.exec(message)?.[1];
    if (status) {
      throw new ChatGptWebAttachmentError(`Attachment URL returned status ${status}`);
    }
    if (/blocked|private address|metadata|redirect/i.test(message)) {
      throw new ChatGptWebAttachmentError("Attachment URL is invalid or blocked");
    }
    throw new ChatGptWebAttachmentError("Attachment URL could not be fetched");
  }
}

function validateImage(bytes, declaredMimeType) {
  const format = sniffImageFormat(bytes);
  const dimensions = sniffImageDimensions(bytes);
  const detectedMime = format === "jpeg" ? "image/jpeg" : format ? `image/${format}` : undefined;
  if (!detectedMime || !dimensions) {
    throw new ChatGptWebAttachmentError("Image attachment is undecodable or unsupported");
  }
  if (declaredMimeType.startsWith("image/") && declaredMimeType !== detectedMime) {
    const jpegAlias = declaredMimeType === "image/jpg" && detectedMime === "image/jpeg";
    if (!jpegAlias)
      throw new ChatGptWebAttachmentError("Image attachment type does not match its data");
  }
  if (
    Math.max(dimensions.width, dimensions.height) > MAX_IMAGE_DECODE_EDGE ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new ChatGptWebAttachmentError("Image attachment dimensions are too large");
  }
  return { mimeType: detectedMime, width: dimensions.width, height: dimensions.height };
}

export async function resolveChatGptWebAttachments(sources, deps = {}) {
  if (sources.length > MAX_CHATGPT_WEB_ATTACHMENTS) {
    throw new ChatGptWebAttachmentError(
      `ChatGPT Web accepts at most ${MAX_CHATGPT_WEB_ATTACHMENTS} attachments per request`
    );
  }
  const resolved = [];
  let totalBytes = 0;
  for (const source of sources) {
    const cap = source.kind === "image" ? MAX_CHATGPT_WEB_IMAGE_BYTES : MAX_CHATGPT_WEB_FILE_BYTES;
    const loaded = source.ref.toLowerCase().startsWith("data:")
      ? decodeDataUrl(source.ref)
      : await fetchRemoteAttachment(source.ref, cap, deps.fetchRemoteMedia ?? fetchRemoteMedia);
    if (!loaded.bytes.length) throw new ChatGptWebAttachmentError("Attachment is empty");
    if (loaded.bytes.length > cap) throw new ChatGptWebAttachmentError("Attachment is too large");
    totalBytes += loaded.bytes.length;
    if (totalBytes > MAX_CHATGPT_WEB_TOTAL_ATTACHMENT_BYTES) {
      throw new ChatGptWebAttachmentError("Combined ChatGPT Web attachments are too large");
    }

    if (source.kind === "image") {
      const image = validateImage(loaded.bytes, source.mimeType ?? loaded.mimeType);
      resolved.push({
        kind: "image",
        name: source.name,
        mimeType: image.mimeType,
        size: loaded.bytes.length,
        data: loaded.bytes,
        width: image.width,
        height: image.height,
      });
      continue;
    }
    resolved.push({
      kind: "file",
      name: source.name,
      mimeType: source.mimeType ?? loaded.mimeType,
      size: loaded.bytes.length,
      data: loaded.bytes,
    });
  }
  return resolved;
}
