import { nowSec, urlToBase64 } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { isString, isUndefined } from "../../../src/shared/utils/typeChecks.js";
import { fetchImageAsBase64, parseDataUri } from "../../translator/concerns/image.js";

const BASE_URL = PROVIDER_MEDIA["cloudflare-ai"]?.imageConfig?.baseUrl;

const MULTIPART_MODELS = new Set([
"@cf/black-forest-labs/flux-2-dev",
"@cf/black-forest-labs/flux-2-klein-4b",
"@cf/black-forest-labs/flux-2-klein-9b"]
);

const OPTIONAL_FIELDS = [
"negative_prompt",
"guidance",
"seed",
"num_steps",
"steps",
"strength"];


function sizeToDimensions(size) {
  const match = /^(\d+)x(\d+)$/.exec(String(size || ""));
  if (!match) return {};
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

function getDimensions(body) {
  return {
    ...sizeToDimensions(body.size),
    ...(Number.isFinite(Number(body.width)) ? { width: Number(body.width) } : null),
    ...(Number.isFinite(Number(body.height)) ? { height: Number(body.height) } : null)
  };
}

async function resolveImageInput(value, options) {
  if (Array.isArray(value)) {
    return { bytes: value, b64: Buffer.from(value).toString("base64") };
  }
  if (!isString(value)) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    const b64 = await urlToBase64(trimmed, options);
    return { bytes: base64ToBytes(b64), b64 };
  }
  const match = /^data:image\/[^;]+;base64,(.+)$/i.exec(trimmed);
  const b64 = match ? match[1] : trimmed;
  return { bytes: base64ToBytes(b64), b64 };
}

function base64ToBytes(value) {
  try {
    return Array.from(Buffer.from(value, "base64"));
  } catch {
    return value;
  }
}

function addOptionalFields(target, body, append) {
  for (const key of OPTIONAL_FIELDS) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    append(target, key, value);
  }
}

// FLUX.1 Schnell rejects dimensions in its closed input schema.
async function buildJsonBody(model, body, options) {
  const req = { prompt: body.prompt };
  if (model !== "@cf/black-forest-labs/flux-1-schnell") Object.assign(req, getDimensions(body));

  addOptionalFields(req, body, (target, key, value) => {
    target[key] = value;
  });

  const imageData = await resolveImageInput(body.image, options);
  if (imageData) {
    req.image_b64 = imageData.b64;
    req.image = imageData.bytes;
  }

  const maskData = await resolveImageInput(body.mask_image || body.maskImage || body.mask, options);
  if (maskData) {
    req.mask_b64 = maskData.b64;
    req.mask = maskData.bytes;
    req.mask_image = maskData.bytes;
  }

  return req;
}

/**
 * Client-side rejection: the request asked for something this endpoint cannot
 * honour. Marked as a 400 so the caller sees the request error instead of a
 * provider failure.
 */
function invalidReference(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * FLUX.2 takes a single reference image as a binary multipart file part.
 * `image` may be a data URI, raw base64, a byte array, or a remote URL; the
 * remote URL is fetched through the guarded image fetcher so a private or
 * disguised payload can never be pulled in.
 */
async function buildMultipartBody(body, options) {
  if (body.images != null && (!Array.isArray(body.images) || body.images.length > 0)) {
    throw invalidReference("FLUX.2 expects a single reference in image; images is not supported");
  }

  const form = new FormData();
  form.append("prompt", body.prompt);

  const dimensions = getDimensions(body);
  for (const [key, value] of Object.entries(dimensions)) {
    form.append(key, String(value));
  }

  addOptionalFields(form, body, (target, key, value) => {
    target.append(key, String(value));
  });

  let image = isString(body.image) ? body.image.trim() : body.image;
  if (image != null && image !== "") {
    if (Array.isArray(image)) {
      for (const byte of image) {
        if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
          throw invalidReference("Invalid reference image");
        }
      }
    }
    if (isString(image) && /^https?:\/\//i.test(image)) {
      const fetched = await fetchImageAsBase64(image, options);
      if (options?.signal?.aborted) throw options.signal.reason;
      if (!fetched) throw invalidReference("Unable to fetch reference image safely");
      image = fetched.url;
    }
    const imageData = await resolveImageInput(image);
    if (!imageData?.bytes?.length) throw invalidReference("Invalid reference image");
    form.append("input_image_0", new Blob([Uint8Array.from(imageData.bytes)], {
      type: parseDataUri(image)?.mimeType || "application/octet-stream",
    }), "reference-image");
  }

  return form;
}

function imageItemFromString(value) {
  if (!isString(value) || !value) return null;
  if (/^data:image\/[^;]+;base64,/i.test(value)) {
    return { b64_json: value.replace(/^data:image\/[^;]+;base64,/i, "") };
  }
  if (/^https?:\/\//i.test(value)) return { url: value };
  return { b64_json: value };
}

function normalizeCloudflareResponse(responseBody) {
  if (responseBody?.created && Array.isArray(responseBody?.data)) return responseBody;

  const result = responseBody?.result ?? responseBody;
  const queuedResponse = Array.isArray(result?.responses) ?
  result.responses.find((item) => item?.success !== false)?.result :
  null;
  if (queuedResponse) return normalizeCloudflareResponse(queuedResponse);

  const image =
  (isString(result) ? result : null) ||
  result?.image ||
  result?.data?.[0]?.b64_json ||
  result?.data?.[0]?.url;

  const item = imageItemFromString(image);
  return {
    created: nowSec(),
    data: item ? [item] : []
  };
}

export default {
  buildUrl: (model, creds) => {
    const accountId = creds?.providerSpecificData?.accountId;
    if (!accountId) throw new Error("cloudflare-ai requires accountId in providerSpecificData");
    return `${BASE_URL}/${accountId}/ai/run/${model}`;
  },

  buildHeaders: (creds, requestBody) => {
    const headers = {};
    const isMultipart = !isUndefined(FormData) && requestBody instanceof FormData;
    if (!isMultipart) {
      headers["Content-Type"] = "application/json";
    }
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  },

  buildBody: async (model, body, options) =>
  MULTIPART_MODELS.has(model) ?
  await buildMultipartBody(body, options) :
  await buildJsonBody(model, body, options),


  async parseResponse(response) {
    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
    if (contentType.startsWith("image/")) {
      const buf = await response.arrayBuffer();
      return {
        created: nowSec(),
        data: [{ b64_json: Buffer.from(buf).toString("base64") }]
      };
    }

    const json = await response.json();
    return normalizeCloudflareResponse(json);
  },

  normalize: normalizeCloudflareResponse
};