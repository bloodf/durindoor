/**
 * Image input (vision) for Microsoft 365 Copilot.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/executors/m365Protocol/images.ts`
 * at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
 *
 * The web client uploads a pasted image to `/m365Copilot/UploadFile`, keyed to the conversation, and
 * points the chat message at the returned `docId` with an `ImageFile` message annotation. The same chat
 * access token authorizes the upload, so the upload is a credentialed request: it never follows a
 * redirect to another origin (credentialFetch). HTTPS image URLs are fetched through the public-only,
 * DNS-pinned remote media guard.
 */
import { randomUUID } from "node:crypto";
import { credentialFetch } from "../utils/credentialFetch.js";
import { sniffImageFormat } from "../utils/imageSniff.js";
import { fetchRemoteMedia } from "../utils/chatgptWebAttachments.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { M365ExecutorError } from "./copilot-m365-output.js";

/** Local bounds: Copilot's own limits are not documented, so these keep a request reasonable. */
export const M365_MAX_IMAGES = 10;
export const M365_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const M365_MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 60_000;
const REMOTE_FETCH_TIMEOUT_MS = 15_000;
const MAX_REMOTE_REDIRECTS = 3;
const UPLOAD_SCENARIO = "OfficeWebIncludedCopilot";
const UPLOAD_OPTION_SETS = ["cwcgptvsan", "flux_v3_gptv_enable_upload_multi_image_in_turn_wo_ch"];
const DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp);base64,/i;
const SUPPORTED = new Set(["png", "jpeg", "gif", "webp"]);

/** Swappable `fetch` for the upload request (tests only); resolved per call, never bound early. */
let uploadFetch = (input, init) => fetch(input, init);
/** Replace the upload `fetch` for a test; returns a function restoring the previous one. */
export function __setM365UploadFetchForTesting(impl) {
  const previous = uploadFetch;
  uploadFetch = impl;
  return () => {
    uploadFetch = previous;
  };
}

let remoteFetch = fetchRemoteMedia;
/** Replace the remote image fetch for a test; returns a function restoring the previous one. */
export function __setM365RemoteImageFetchForTesting(impl) {
  const previous = remoteFetch;
  remoteFetch = impl;
  return () => {
    remoteFetch = previous;
  };
}

const invalidImage = (message) => new M365ExecutorError(400, "m365_image_invalid", message);

/**
 * The image reference of a message content part, or null for any other part. Accepts the Chat
 * Completions shape (`image_url: { url }` or a bare string) and the Responses `input_image`.
 */
export function m365ImagePartRef(part) {
  if (!isRecord(part) || part.type !== "image_url" && part.type !== "input_image") return null;
  const ref = isString(part.image_url) ? part.image_url : isRecord(part.image_url) ? part.image_url.url : undefined;
  if (!isString(ref) || !ref) throw invalidImage("An image part has no image URL.");
  return ref;
}

/** Decode a base64 image data URL, refusing anything that does not round-trip exactly. */
function decodeDataUrl(ref) {
  const payload = ref.slice(ref.indexOf(",") + 1);
  if (
  !DATA_URL.test(ref) ||
  !payload ||
  payload.length > Math.ceil(M365_MAX_IMAGE_BYTES / 3) * 4 ||
  !/^[A-Za-z0-9+/]*={0,2}$/.test(payload))
  {
    throw invalidImage("Expected a base64 PNG, JPEG, GIF or WebP image of at most 10 MiB.");
  }
  const data = Buffer.from(payload, "base64");
  if (data.toString("base64").replace(/=+$/, "") !== payload.replace(/=+$/, "")) {
    throw invalidImage("The image data URL is not valid base64.");
  }
  return data;
}

async function fetchImageUrl(ref, signal) {
  if (!ref.startsWith("https://")) throw invalidImage("Image URLs must be data URLs or HTTPS.");
  try {
    const result = await remoteFetch(ref, {
      maxBytes: M365_MAX_IMAGE_BYTES,
      maxRedirects: MAX_REMOTE_REDIRECTS,
      timeoutMs: REMOTE_FETCH_TIMEOUT_MS
    });
    return Buffer.from(result.buffer);
  } catch {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Request aborted", "AbortError");
    throw invalidImage("Could not fetch the image from a public HTTPS URL.");
  }
}

/** Resolve an image reference to bytes of a format Copilot accepts, sniffed from the bytes themselves. */
export async function resolveM365Image(ref, signal) {
  const data = ref.startsWith("data:") ? decodeDataUrl(ref) : await fetchImageUrl(ref, signal);
  const format = sniffImageFormat(data);
  if (!SUPPORTED.has(format) || data.length === 0 || data.length > M365_MAX_IMAGE_BYTES) {
    throw invalidImage("Expected a PNG, JPEG, GIF or WebP image of at most 10 MiB.");
  }
  return {
    dataUrl: `data:image/${format};base64,${data.toString("base64")}`,
    fileType: format === "jpeg" ? "jpg" : format,
    bytes: data.length
  };
}

/**
 * Resolves each distinct image reference once per request, enforcing the per-request image count and
 * total size. Turns that re-send images (a fresh-conversation retry) reuse the bytes.
 */
export class M365ImageResolver {
  resolved = new Map();
  total = 0;

  constructor(signal) {
    this.signal = signal;
  }

  async resolve(refs) {
    const images = [];
    for (const ref of refs) {
      let pending = this.resolved.get(ref);
      if (!pending) {
        if (this.resolved.size >= M365_MAX_IMAGES) {
          throw invalidImage(`Microsoft 365 Copilot accepts at most ${M365_MAX_IMAGES} images.`);
        }
        pending = resolveM365Image(ref, this.signal).then((image) => {
          this.total += image.bytes;
          if (this.total > M365_MAX_TOTAL_IMAGE_BYTES) throw invalidImage("The images exceed the 40 MiB request limit.");
          return image;
        });
        this.resolved.set(ref, pending);
      }
      images.push(await pending);
    }
    return images;
  }
}

function uploadFailure(status) {
  if (status === 401) {
    return new M365ExecutorError(401, "m365_image_upload_unauthorized", "Microsoft 365 Copilot refused the image upload credentials. Reconnect this account.");
  }
  if (status === 429) {
    return new M365ExecutorError(429, "m365_throttled", "Microsoft 365 Copilot is throttling this account. Retry later.");
  }
  if (status === 400 || status === 413 || status === 415) {
    return new M365ExecutorError(400, "m365_image_rejected", "Microsoft 365 Copilot rejected the image.");
  }
  return new M365ExecutorError(502, "m365_image_upload_failed", "Microsoft 365 Copilot image upload failed.");
}

/**
 * Upload one image into a conversation and return the annotation that attaches it to the conversation's
 * next chat message. Fails closed: an image Copilot did not receive is an error, never a turn that goes
 * ahead without it.
 */
export async function uploadM365Image({ host, accessToken, conversationId, image, signal }) {
  const form = new URLSearchParams({ scenario: "UploadImage", conversationId, FileBase64: image.dataUrl });
  for (const option of UPLOAD_OPTION_SETS) form.append("optionsSets", option);
  const timeout = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await credentialFetch(uploadFetch, `https://${host}/m365Copilot/UploadFile`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Scenario": UPLOAD_SCENARIO,
        "X-Variants": "feature.EnableImageSupportInUploadFile",
        Origin: "https://m365.cloud.microsoft",
        Referer: "https://m365.cloud.microsoft/"
      },
      body: form,
      signal: combined
    });
  } catch {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Request aborted", "AbortError");
    throw uploadFailure(502);
  }
  if (!response.ok) {
    await response.body?.cancel?.();
    throw uploadFailure(response.status);
  }
  let docId;
  try {
    docId = (await response.json())?.docId;
  } catch {
    docId = undefined;
  }
  if (!isString(docId) || !docId || docId.length > 512) throw uploadFailure(502);
  const { fileType } = image;
  return {
    id: docId,
    messageAnnotationType: "ImageFile",
    messageAnnotationMetadata: {
      "@type": "File",
      annotationType: "File",
      fileType,
      fileName: `image-${randomUUID().slice(0, 8)}.${fileType}`
    }
  };
}
