import { createErrorResult, parseUpstreamError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

function isRecord(value) {
  return value !== null && isObject(value) && !Array.isArray(value);
}

// OpenAI-compatible providers derive `/images/edits` from generations. Native
// providers may declare their distinct endpoint and wire format explicitly.
export function getImageEditConfig(mediaCfg) {
  const nativeConfig = isRecord(mediaCfg?.imageEditConfig) ? mediaCfg.imageEditConfig : null;
  if (nativeConfig) return nativeConfig;
  const baseUrl = deriveImageEditsUrl(isRecord(mediaCfg) ? mediaCfg.imageConfig : undefined);
  return baseUrl ? { baseUrl, format: "multipart" } : null;
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
  if (isNativeJson) {
    upstream = { ...(jsonBody || {}) };
    upstream.model = model;
    upstream.prompt = upstream.prompt || formData.get("prompt");
    if (!upstream.image) {
      const images = await Promise.all(formData.getAll("image").map(async (value) => {
        if (!(value instanceof Blob)) return value;
        return `data:${value.type || "application/octet-stream"};base64,${Buffer.from(await value.arrayBuffer()).toString("base64")}`;
      }));
      upstream.image = images.length === 1 ? images[0] : images;
    }
  } else {
    upstream = new FormData();
    for (const [key, value] of formData.entries()) {
      if (key === "model") continue;
      if (value instanceof Blob) upstream.append(key, value, value.name || key);else upstream.append(key, value);
    }
    upstream.append("model", model);
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
    res = await proxyAwareFetch(editConfig.baseUrl, { method: "POST", headers, body: isNativeJson ? JSON.stringify(upstream) : upstream });
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err?.message || "Image edit request failed");
  }
  if (!res.ok) {
    const errInfo = await parseUpstreamError(res, null);
    return createErrorResult(errInfo.statusCode || res.status, errInfo.message || `Upstream error from ${provider}`);
  }
  if (onRequestSuccess) await onRequestSuccess();
  const text = await res.text();
  return { success: true, status: res.status, response: new Response(text, { status: 200, headers: { "Content-Type": res.headers.get("content-type") || "application/json", "Access-Control-Allow-Origin": "*" } }) };
}