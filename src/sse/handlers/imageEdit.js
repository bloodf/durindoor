import { admit } from "../services/admission.js";
import { applyOpenRouterRouting } from "open-sse/services/openrouterRouting.js";
import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { captureRequestBillingEpoch, getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getProviderCredentialsWithQuotaPreflight,
  markAccountUnavailable,
  clearAccountError,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleImageEditCore, isImageSource } from "open-sse/handlers/imageEditCore.js";
import { runWithModelFallback } from "open-sse/services/modelFallback.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { toExecutorCredentials } from "./typeHelpers.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { imageModelKindError } from "./imageModelKind.js";
import { MAX_IMAGE_BYTES } from "open-sse/config/mediaConfig.js";
const MAX_UPLOAD_OVERHEAD_BYTES = 1024 * 1024;

async function readBoundedRequest(request, maxBytes) {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { method: request.method, headers, body: Buffer.concat(chunks), signal: request.signal });
}

// Allow large image uploads (mask + image can be several MB).
import { isObject, isString } from "../../shared/utils/typeChecks.js";
export const maxDuration = 300;


/**
 * Handle image-edit request — OpenAI /v1/images/edits multipart passthrough.
 * Records complete core accounting, including provider receipts and provenance.
 * Response bodies remain untouched; pending accounting is never committed.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleImageEditHandler(request) {
  await captureRequestBillingEpoch(request);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES + MAX_UPLOAD_OVERHEAD_BYTES) return errorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Image edit upload exceeds 10 MiB");
  const boundedRequest = await readBoundedRequest(request, MAX_IMAGE_BYTES + MAX_UPLOAD_OVERHEAD_BYTES);
  if (!boundedRequest) return errorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Image edit upload exceeds 10 MiB");
  let formData;
  let jsonBody = null;
  try {
    if ((request.headers.get("content-type") || "").includes("application/json")) {
      jsonBody = await boundedRequest.json();
      const hasImage = jsonBody?.image !== undefined;
      const hasImages = jsonBody?.images !== undefined;
      const validImages = hasImage ? isImageSource(jsonBody.image) : Array.isArray(jsonBody?.images) && jsonBody.images.length > 0 && jsonBody.images.every(isImageSource);
      if (!jsonBody || !isObject(jsonBody) || Array.isArray(jsonBody) || !isString(jsonBody.model) || !jsonBody.model.trim() || !isString(jsonBody.prompt) || !jsonBody.prompt.trim() || hasImage === hasImages || !validImages) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Image edit JSON requires nonempty string model, prompt, and image or images source(s)");
      formData = new FormData();
      formData.append("model", jsonBody.model);
      formData.append("prompt", jsonBody.prompt);
      formData.append("image", "json-image");
    } else formData = await boundedRequest.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid image edit body");
  }
  for (const key of ["image", "images", "mask"]) {
    if (formData.getAll(key).some((value) => value instanceof Blob && value.size > MAX_IMAGE_BYTES)) return errorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Image edit upload exceeds 10 MiB");
  }

  const modelField = formData.get("model");
  const modelStr = isString(modelField) ? modelField : null;
  const url = new URL(request.url);
  log.request("POST", `${url.pathname} | ${modelStr}`);

  const { settings, apiKey, auth: apiKeyAuth, error: admissionError } = await admit(request, { kind: "imageEdit" });
  // Model and account fallbacks retain the admission epoch, including null.
  const { billingEpoch } = apiKeyAuth;
  if (admissionError) return admissionError;

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!formData.get("image")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: image");
  if (!formData.get("prompt")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

  return runWithModelFallback(
    modelStr,
    settings.modelFallbacks,
    (m) => handleSingleModelImageEdit(m, formData, jsonBody, request, apiKey, apiKeyAuth.apiKeyId, billingEpoch),
    log
  );
}

async function handleSingleModelImageEdit(modelStr, formData, jsonBody, request, apiKey, apiKeyId, billingEpoch) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  if (provider === "openrouter") {
    try { applyOpenRouterRouting(jsonBody || {}, (await getSettings()).openrouterRouting, "image"); }
    catch (error) { return errorResponse(HTTP_STATUS.BAD_REQUEST, error.message); }
  }

  const resolvedPolicyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (resolvedPolicyError) return resolvedPolicyError;
  const kindError = await imageModelKindError(provider, model, await getSettings());
  if (kindError) return kindError;
  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentialsWithQuotaPreflight(provider, excludeConnectionIds, model, { apiKeyId });

    // All accounts unavailable or provider disabled
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        log.warn("IMAGE_EDIT", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${msg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const dispatch = credentialDispatchSnapshot(credentials);
    const result = await handleImageEditCore({
      formData,
      jsonBody,
      modelInfo: { provider, model },
      credentials: toExecutorCredentials({ ...credentials }),
      log,
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model, dispatch);
      }
    });

    if (result.success) {
      if (result.accounting?.state !== "complete") return result.response;
      const { modality, tokens, nativeUnits, cost, costStatus, costSource, meta } = result.accounting;
      return recordApiKeyUsageForResponse(apiKey, result.response, {
        billingEpoch,
        usageEventId: JSON.stringify([getRequestId(request), "image-edit", provider, model, credentials.connectionId ?? null]), provider, model,
        connectionId: credentials.connectionId ?? null, endpoint: "/v1/images/edits",
        modality, tokens, nativeUnits, cost, costStatus, costSource, meta,
        // The stable id of the admitted key travels with the usage.
        apiKeyId,
      });
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, null, {
      // The credential this attempt actually presented, so a durable-key
      // provider can mark exactly the generation that was rejected.
      usedCredential: credentials.accessToken || credentials.apiKey || null,
      ...dispatch
    });
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response || errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image edit failed");
  }
}
export const handleImageEdit = withRequestCorrelation(handleImageEditHandler);
