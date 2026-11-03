import { createErrorResult, parseUpstreamError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { mediaAccounting, returnedImageUnits } from "./mediaAccounting.js";

const XAI_IMAGE_EDIT_FIELDS = new Set(["n", "response_format", "quality", "resolution", "aspect_ratio", "storage_options"]);

export function isImageSource(value) {
  if (isString(value)) return value.trim().length > 0;
  if (!isRecord(value)) return false;
  const hasUrl = isString(value.url) && value.url.trim().length > 0;
  const hasFile = isString(value.file_id) && value.file_id.trim().length > 0;
  return hasUrl !== hasFile &&
    (value.type === undefined || hasUrl && value.type === "image_url") &&
    Object.keys(value).every((key) => key === "url" || key === "file_id" || key === "type");
}

function toImageSource(value) {
  if (isString(value) && value.trim()) return { url: value };
  if (isRecord(value) && isImageSource(value)) return { ...value };
  throw new Error("image must be a nonempty URL/data URI or an object containing url or file_id");
}

async function toMultipartImageSource(value) {
  if (!(value instanceof Blob)) return toImageSource(value);
  return { url: `data:${value.type || "application/octet-stream"};base64,${Buffer.from(await value.arrayBuffer()).toString("base64")}` };
}

function setXaiImages(upstream, sources) {
  if (!sources.length || sources.length > 5) throw new Error("xAI image edits require between 1 and 5 source images");
  if (sources.length === 1) upstream.image = sources[0];else upstream.images = sources;
}

async function buildXaiImageEditBody(formData, jsonBody, model) {
  const upstream = { ...jsonBody, model, prompt: jsonBody?.prompt || formData.get("prompt") };
  if (jsonBody) {
    delete upstream.image;
    delete upstream.images;
    const hasImage = jsonBody.image !== undefined;
    const hasImages = jsonBody.images !== undefined;
    if (hasImage === hasImages) throw new Error("xAI image edits require exactly one of image or images");
    if (hasImages ? !Array.isArray(jsonBody.images) : Array.isArray(jsonBody.image)) throw new Error("xAI image edits require image as one source or images as an array of sources");
    const rawSources = hasImages ? jsonBody.images : [jsonBody.image];
    const sources = rawSources.map(toImageSource);
    setXaiImages(upstream, sources);
    return upstream;
  }

  for (const field of XAI_IMAGE_EDIT_FIELDS) {
    const value = formData.get(field);
    if (value !== null) upstream[field] = field === "n" ? Number(value) : field === "storage_options" ? JSON.parse(value) : value;
  }
  const sources = await Promise.all([...formData.getAll("image"), ...formData.getAll("images")].map(toMultipartImageSource));
  setXaiImages(upstream, sources);
  return upstream;
}

function isRecord(value) {
  return value !== null && isObject(value) && !Array.isArray(value);
}

// OpenAI-compatible providers derive `/images/edits` from generations. Native
// providers may declare their distinct endpoint and wire format explicitly.
export function getImageEditConfig(mediaCfg) {
  const nativeConfig = isRecord(mediaCfg?.imageEditConfig) ? mediaCfg.imageEditConfig : null;
  if (nativeConfig) return nativeConfig;
  const imageConfig = isRecord(mediaCfg) ? mediaCfg.imageConfig : undefined;
  const baseUrl = deriveImageEditsUrl(imageConfig);
  return baseUrl ? { baseUrl, format: "multipart", headers: imageConfig?.headers } : null;
}

export function deriveImageEditsUrl(imageConfig) {
  const rec = isRecord(imageConfig) ? imageConfig : undefined;
  const base = isString(rec?.baseUrl) ? rec.baseUrl : undefined;
  if (base && /\/images\/generations$/.test(base)) return base.replace(/\/generations$/, "/edits");
  return null;
}

/**
 * Core image-edit handler — OpenAI-compatible /v1/images/edits multipart passthrough.
 * Forwards the client's multipart formData (image, mask, prompt, model, n, size,
 * response_format) verbatim to the provider's /images/edits endpoint, overriding
 * `model` with the resolved upstream id.
 *
 * @param {object} options
 * @param {FormData} options.formData
 * @param {object|null} [options.jsonBody]
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} [options.log]
 * @param {function} [options.onRequestSuccess]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleImageEditCore({
  formData,
  jsonBody = null,
  modelInfo,
  credentials = null,
  log = null,
  onRequestSuccess = null
}) {
  const { provider, model } = modelInfo;
  const mediaCfg = PROVIDER_MEDIA[provider];
  const editConfig = getImageEditConfig(mediaCfg);
  if (!editConfig?.baseUrl) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not expose an image edit endpoint`);
  }

  const isNativeJson = editConfig.format === "json";
  if (jsonBody && !isNativeJson) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' requires multipart image edits`);
  }
  let upstream;
  try {
    if (isNativeJson) {
      upstream = await buildXaiImageEditBody(formData, jsonBody, model);
    } else {
      upstream = new FormData();
      for (const [key, value] of formData.entries()) {
        if (key === "model") continue;
        if (value instanceof Blob) upstream.append(key, value, value.name || key);else upstream.append(key, value);
      }
      upstream.append("model", model);
    }
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, err?.message || "Invalid image edit request");
  }

  const headers = {};
  const cfgHeaders = isRecord(editConfig.headers) ? editConfig.headers : {};
  for (const [k, v] of Object.entries(cfgHeaders)) headers[k] = v;
  if (isNativeJson) headers["Content-Type"] = "application/json";
  const key = credentials?.apiKey || credentials?.accessToken;
  if (key) headers.Authorization = `Bearer ${key}`;

  log?.debug?.("IMAGE-EDIT", `${provider} | ${model} | ${editConfig.baseUrl}`);
  let res;
  try {
    res = await proxyAwareFetch(editConfig.baseUrl, { method: "POST", headers, body: isNativeJson ? JSON.stringify(upstream) : upstream }, resolveCredentialProxyOptions(credentials));
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err?.message || "Image edit request failed");
  }
  if (!res.ok) {
    const errInfo = await parseUpstreamError(res, null);
    return createErrorResult(errInfo.statusCode || res.status, errInfo.message || `Upstream error from ${provider}`);
  }
  if (onRequestSuccess) await onRequestSuccess();
  const text = await res.text();
  let value = null;
  try { value = JSON.parse(text); } catch { /* Preserve opaque successful responses. */ }
  const accounting = mediaAccounting(value, provider, "image");
  returnedImageUnits(accounting, value);
  return { success: true, status: res.status, accounting, response: new Response(text, { status: 200, headers: { "Content-Type": res.headers.get("content-type") || "application/json", "Access-Control-Allow-Origin": "*" } }) };
}