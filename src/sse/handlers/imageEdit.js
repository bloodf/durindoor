import { keepAbortChain } from "@/shared/utils/abortChain.js";
import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { captureRequestBillingEpoch, getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import { clearAccountError } from "../services/auth.js";
import { getImageEditAdapter, handleImageEditCore, isImageSource } from "open-sse/handlers/imageEditCore.js";
import { ACCEPTED_JOB_HEADER } from "open-sse/services/combo.js";
import { runWithModelFallback } from "open-sse/services/modelFallback.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { toExecutorCredentials } from "./typeHelpers.js";
import { recordAcceptedJobUsage, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { resolveImageModel, runMediaAccounts, runMediaEndpoint } from "./media/pipeline.js";
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
  return keepAbortChain(new Request(request.url, { method: request.method, headers, body: Buffer.concat(chunks), signal: request.signal }), request);
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

  return runMediaEndpoint(request, {
    kind: "imageEdit",
    route: (admission) => routeImageEdit(request, modelStr, formData, jsonBody, admission),
  });
}

function routeImageEdit(request, modelStr, formData, jsonBody, { settings, apiKey, auth: apiKeyAuth }) {
  // Model and account fallbacks retain the admission epoch, including null.
  const { billingEpoch } = apiKeyAuth;
  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!formData.get("image")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: image");
  if (!formData.get("prompt")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

  // A generation the provider accepted may still bill, so no fallback model
  // receives the same edit: every later fallback step answers that response.
  let accepted = null;
  const replay = () => new Response(accepted.body, { status: accepted.status, statusText: accepted.statusText, headers: accepted.headers });
  return runWithModelFallback(
    modelStr,
    settings.modelFallbacks,
    async (m) => {
      if (accepted) return replay();
      const response = await handleSingleModelImageEdit(m, formData, jsonBody, request, apiKey, apiKeyAuth.apiKeyId, billingEpoch);
      if (!response.headers.get(ACCEPTED_JOB_HEADER)) return response;
      accepted = { body: await response.arrayBuffer(), status: response.status, statusText: response.statusText, headers: new Headers(response.headers) };
      return replay();
    },
    log
  );
}

/** Record a submitted, possibly billed edit once on the account that sent it. */
async function recordAcceptedEdit(apiKey, result, request, { provider, model, connectionId, billingEpoch, apiKeyId }) {
  try {
    await recordAcceptedJobUsage(apiKey, {
      ...result.acceptedJob,
      billingEpoch,
      usageEventId: JSON.stringify([getRequestId(request), "image-edit", provider, model, connectionId]),
      provider, model, connectionId, endpoint: "/v1/images/edits", modality: "image",
      apiKeyId,
    });
  } catch {
    // The request already ended without a result; a ledger failure never replaces that outcome.
    log.warn("IMAGE_EDIT", `[${provider}/${model}] accepted edit could not be recorded`);
  }
  const response = result.response || errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image edit failed");
  const headers = new Headers(response.headers);
  headers.set(ACCEPTED_JOB_HEADER, "1");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleSingleModelImageEdit(modelStr, formData, jsonBody, request, apiKey, apiKeyId, billingEpoch) {
  const { provider, model, error } = await resolveImageModel(request, modelStr, jsonBody || {}, apiKey);
  if (error) return error;
  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  const native = getImageEditAdapter(provider) !== null;
  const accepted = (result, credentials) => recordAcceptedEdit(apiKey, result, request, {
    provider, model, connectionId: credentials.connectionId ?? null, billingEpoch, apiKeyId,
  });

  return runMediaAccounts({
    provider,
    model,
    signal: request.signal,
    selectionOptions: { apiKeyId },
    buildExhaustedResponse(credentials, { lastError, lastStatus, attempted }) {
      if (credentials?.providerDisabled) {
        log.warn("IMAGE_EDIT", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${msg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (attempted === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    },
    async runAttempt(credentials) {
      log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

      const dispatch = credentialDispatchSnapshot(credentials);
      const result = await handleImageEditCore({
        formData,
        jsonBody,
        modelInfo: { provider, model },
        credentials: toExecutorCredentials({ ...credentials }),
        signal: request.signal,
        log,
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials, model, dispatch);
        }
      });

      if (result.success) {
        if (result.accounting?.state !== "complete") return { response: result.response };
        const { modality, tokens, nativeUnits, cost, costStatus, costSource, meta } = result.accounting;
        const response = await recordApiKeyUsageForResponse(apiKey, result.response, {
          billingEpoch,
          usageEventId: JSON.stringify([getRequestId(request), "image-edit", provider, model, credentials.connectionId ?? null]), provider, model,
          connectionId: credentials.connectionId ?? null, endpoint: "/v1/images/edits",
          modality, tokens, nativeUnits, cost, costStatus, costSource, meta,
          // The stable id of the admitted key travels with the usage.
          apiKeyId,
        });
        if (native) await clearAccountError(credentials.connectionId, credentials, model, dispatch);
        return { response };
      }
      // A native adapter refused the input before any network call: not an account fault.
      if (native && result.phase === "request") return { response: result.response };
      // Client abort: no account cooldown and no other account.
      if (request.signal?.aborted && result.acceptedJob) return { response: await accepted(result, credentials) };
      return { result, dispatch };
    },
    // An accepted generation stops here, after account health, and is never resubmitted.
    onAccountFailure: (result, credentials) => (result.acceptedJob ? accepted(result, credentials) : null),
    buildFailureResponse: (result) => result.response || errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image edit failed"),
  });
}
export const handleImageEdit = withRequestCorrelation(handleImageEditHandler);
