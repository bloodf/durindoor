import { keepAbortChain } from "@/shared/utils/abortChain.js";
import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { modelKindError } from "./modelKind.js";
import { captureRequestBillingEpoch, getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getNoAuthProviderCredentials,
  clearAccountError,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleSttCore } from "open-sse/handlers/sttCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import * as log from "../utils/logger.js";
import { enforceApiKeyModelPolicy, recordAcceptedJobUsage, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { nativeUsageFromValue } from "../services/nativeUsage.js";
import { ACCEPTED_JOB_HEADER, handleComboChat } from "open-sse/services/combo.js";
import { wantsDefaultRoute, resolveMediaRoute, defaultRouteComboOptions, supportsTranslation } from "../services/mediaRoutes.js";
import { MAX_AUDIO_BYTES } from "open-sse/handlers/codexSttAudio.js";
import { runMediaAccounts, runMediaEndpoint } from "./media/pipeline.js";
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

// Providers requiring credentials for STT
const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.serviceKinds?.includes("stt") && !p.noAuth && p.sttConfig?.authType !== "none")
    .map(([id]) => id)
);

async function handleSttHandler(request, { kind = "transcription" } = {}) {
  await captureRequestBillingEpoch(request);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES + MAX_UPLOAD_OVERHEAD_BYTES) return errorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Audio exceeds 25 MiB");
  const boundedRequest = await readBoundedRequest(request, MAX_AUDIO_BYTES + MAX_UPLOAD_OVERHEAD_BYTES);
  if (!boundedRequest) return errorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Audio exceeds 25 MiB");
  let formData;
  try {
    formData = await boundedRequest.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart form data");
  }
  const audioFile = formData.get("file");
  if (audioFile instanceof Blob && audioFile.size > MAX_AUDIO_BYTES) return errorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Audio exceeds 25 MiB");

  const modelStr = formData.get("model");
  log.request("POST", `/v1/audio/${kind === "translation" ? "translations" : "transcriptions"} | ${modelStr}`);

  return runMediaEndpoint(request, { kind: "stt", pinConnection: true, route: (admission) => handleAdmittedStt(request, formData, kind, modelStr, admission) });
}

async function handleAdmittedStt(request, formData, kind, modelStr, { settings, apiKey, auth: apiKeyAuth }) {
  // Keep the admission epoch, including null, through combo and account retries.
  const { billingEpoch } = apiKeyAuth;

  if (!formData.get("file")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");

  if (wantsDefaultRoute(modelStr)) {
    // Translations only reach providers that expose /audio/translations.
    const supports = kind === "translation" ? supportsTranslation : null;
    const route = await resolveMediaRoute("stt", { settings, supports, apiKeyId: apiKeyAuth.apiKeyId });
    if (route.error) return route.error;
    return handleComboChat({
      apiKeyId: apiKeyAuth.apiKeyId,
      body: {},
      models: route.models,
      handleSingleModel: (_b, m) => handleSingleModelStt(formData, m, kind, request, apiKey, apiKeyAuth.apiKeyId, billingEpoch),
      log,
      ...defaultRouteComboOptions("stt")
    });
  }
  return handleSingleModelStt(formData, modelStr, kind, request, apiKey, apiKeyAuth.apiKeyId, billingEpoch);
}

async function handleSingleModelStt(formData, modelStr, kind, request, apiKey, apiKeyId, billingEpoch) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const { provider, model } = modelInfo;
  if (provider === "codex" && model !== "transcribe") return errorResponse(HTTP_STATUS.BAD_REQUEST, "Use model cx/transcribe for Codex STT");
  const resolvedPolicyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (resolvedPolicyError) return resolvedPolicyError;
  const kindError = await modelKindError(provider, model, await getSettings(), "stt");
  if (kindError) return kindError;
  const connectionId = request.headers.get("x-connection-id") || null;
  const pinOptions = connectionId ? { preferredConnectionId: connectionId, strictConnectionId: connectionId } : {};

  /** One logical event survives account/combo retries. Only successful execution
   * reaches the ledger; provider tokens are validated there without inventing a split.
   * Whisper's published $0.006/minute rate applies only to the official endpoint:
   * https://developers.openai.com/api/docs/pricing (2026-10-09).
   */
  const recordSuccess = (result, credentials) => {
    const nativeUnits = result.nativeUnits || {};
    const priced = provider === "openai" && model === "whisper-1" &&
      AI_PROVIDERS[provider]?.sttConfig?.baseUrl === "https://api.openai.com/v1/audio/transcriptions" &&
      nativeUnits.audioSeconds !== undefined;
    return recordApiKeyUsageForResponse(apiKey, result.response, {
      billingEpoch,
      usageEventId: `${getRequestId(request)}:stt`, provider, model,
      connectionId: credentials.connectionId || null,
      endpoint: kind === "translation" ? "/v1/audio/translations" : "/v1/audio/transcriptions",
      modality: "stt", tokens: nativeUsageFromValue(result.usageValue) || {}, nativeUnits,
      cost: priced ? nativeUnits.audioSeconds * 0.006 / 60 : null,
      costStatus: priced ? "estimated" : "unknown",
      costSource: priced ? "https://developers.openai.com/api/docs/pricing#whisper" : "unavailable",
      // The stable id of the admitted key travels with the usage.
      apiKeyId,
    });
  };
  /** A call the provider may have billed without a usable answer (Vertex). It is
   * recorded once with unknown cost on the account that sent it, and the route
   * never falls back to another account with the same audio.
   */
  const recordAccepted = async (result, credentials) => {
    await recordAcceptedJobUsage(apiKey, {
      ...result.acceptedJob,
      billingEpoch,
      usageEventId: `${getRequestId(request)}:stt`, provider, model,
      connectionId: credentials.connectionId || null,
      endpoint: kind === "translation" ? "/v1/audio/translations" : "/v1/audio/transcriptions",
      modality: "stt",
      apiKeyId,
    });
    // A combo must not send the same audio to another model: the job may still bill.
    const response = result.response || errorResponse(result.status, result.error);
    const headers = new Headers(response.headers);
    headers.set(ACCEPTED_JOB_HEADER, "1");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);

  // Local/no-auth execution remains unrestricted only for keys with zero
  // provider-account relations.
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const credentials = await getNoAuthProviderCredentials(provider, model, { ...pinOptions, apiKeyId });
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      return errorResponse(
        credentials?.allRateLimited ? Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.BAD_REQUEST,
        credentials?.lastError || `No credentials for provider: ${provider}`,
      );
    }
    const coreOptions = { provider, model, formData, kind, sttConfig: AI_PROVIDERS[provider]?.sttConfig };
    if (credentials.connectionId) coreOptions.credentials = credentials;
    const result = await handleSttCore(coreOptions);
    if (result.success) return recordSuccess(result, credentials);
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "STT failed");
  }

  // Credentialed — fallback loop
  return runMediaAccounts({
    provider, model, selectionOptions: { ...pinOptions, apiKeyId },
    buildExhaustedResponse(credentials, { lastError, lastStatus, attempted }) {
      if (credentials?.providerDisabled) {
        log.warn("STT", `[${provider}/${model}] free no-auth provider disabled by settings`);
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

    const isCodex = provider === "codex";
    let result;
    let dispatch = credentialDispatchSnapshot(credentials);
    try {
      const attemptCredentials = isCodex ? await checkAndRefreshToken(provider, credentials) : credentials;
      dispatch = credentialDispatchSnapshot(attemptCredentials);
      const args = { provider, model, formData, kind, credentials: attemptCredentials, sttConfig: AI_PROVIDERS[provider]?.sttConfig, signal: request.signal, log };
      result = await handleSttCore(args);
      // One forced refresh when a Codex token is rejected mid-validity.
      if (isCodex && result.status === 401 && attemptCredentials.refreshToken && !request.signal.aborted) {
        const refreshed = await checkAndRefreshToken(provider, attemptCredentials, null, { force: true });
        if (refreshed.accessToken !== attemptCredentials.accessToken) {
          dispatch = credentialDispatchSnapshot(refreshed);
          result = await handleSttCore({ ...args, credentials: refreshed });
        }
      }
    } catch (error) {
      if (!isCodex) throw error;
      return { response: errorResponse(HTTP_STATUS.BAD_GATEWAY, "STT credential or transport failure") };
    }

    if (result.success) {
      if (isCodex) await clearAccountError(credentials.connectionId, credentials, model, dispatch);
      return { response: await recordSuccess(result, credentials) };
    }
    if (isCodex) {
      if (request.signal?.aborted) return { response: errorResponse(HTTP_STATUS.GATEWAY_TIMEOUT, "Transcription cancelled") };
    }
    if (request.signal?.aborted && result.acceptedJob) return { response: await recordAccepted(result, credentials) };
    // Bad audio, unsupported options, a missing ffmpeg and local capacity are not account faults.
    if (result.local) return { response: result.response || errorResponse(result.status, result.error) };
    return { result, dispatch, failureContext: { usedCredential: credentials.accessToken || credentials.apiKey || null } };
    },
    onAccountFailure: (result, credentials) => (result.acceptedJob ? recordAccepted(result, credentials) : null),
    buildFailureResponse: (result) => result.response || errorResponse(result.status, result.error),
  });
}
export const handleStt = withRequestCorrelation(handleSttHandler);
